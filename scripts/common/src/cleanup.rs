//! Garbage collection shared by every binary that deletes library rows.

use sqlx::PgPool;

/// Which `MusicBrainzRelease` rows an orphan sweep may consider.
pub enum MbSweepScope<'a> {
    /// The whole library.
    All,
    /// Releases credited to any of these artists.
    Artists(&'a [String]),
    /// Exactly these release ids.
    Releases(&'a [String]),
}

/// A `MusicBrainzRelease` still needed by something: a bound local release, a dissolved box disc, a
/// linked local track, or another release's disc that names it as its standalone edition.
/// Catalogue placeholders (`MISSING`) are never orphans.
const MB_RELEASE_IN_USE: &str = r#"(
       m.status = 'MISSING'
    OR EXISTS (SELECT 1 FROM "LocalRelease" lr WHERE lr."releaseId" = m.id)
    OR EXISTS (SELECT 1 FROM "LocalRelease" lr WHERE lr."boxReleaseId" = m.id)
    OR EXISTS (
         SELECT 1 FROM "LocalReleaseTrack" lt
         JOIN "MusicBrainzReleaseTrack" mt ON mt.id = lt."mbTrackId"
         WHERE mt."releaseId" = m.id)
    OR EXISTS (
         SELECT 1 FROM "MusicBrainzReleaseMedium" md
         WHERE md."equivalentReleaseId" = m.id AND md."releaseId" <> m.id)
)"#;

/// Deletes the `MusicBrainzRelease` rows in `scope` that nothing uses any more.
pub async fn delete_orphaned_mb_releases(
    pool: &PgPool,
    scope: MbSweepScope<'_>,
) -> Result<u64, sqlx::Error> {
    let (filter, ids): (&str, Option<&[String]>) = match scope {
        MbSweepScope::All => ("TRUE", None),
        MbSweepScope::Artists(ids) => (
            r#"EXISTS (SELECT 1 FROM "MusicBrainzReleaseArtist" mra
                       WHERE mra."releaseId" = m.id AND mra."artistId" = ANY($1::text[]))"#,
            Some(ids),
        ),
        MbSweepScope::Releases(ids) => ("m.id = ANY($1::text[])", Some(ids)),
    };
    let sql =
        format!(r#"DELETE FROM "MusicBrainzRelease" m WHERE {filter} AND NOT {MB_RELEASE_IN_USE}"#);
    let query = sqlx::query(&sql);
    let result = match ids {
        Some([]) => return Ok(0),
        Some(ids) => query.bind(ids).execute(pool).await?,
        None => query.execute(pool).await?,
    };
    Ok(result.rows_affected())
}

/// An `Artist` row nothing refers to: no owned or credited release, not a connected duplicate, not
/// added by hand before owning anything.
pub const ARTIST_UNLINKED: &str = r#"a."primaryArtistId" IS NULL
           AND NOT a."manuallyAdded"
           AND NOT EXISTS (SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = a.id)
           AND NOT EXISTS (SELECT 1 FROM "MusicBrainzReleaseArtist" x WHERE x."artistId" = a.id)
           AND NOT EXISTS (SELECT 1 FROM "TrackRelatedArtist" x WHERE x."artistId" = a.id)"#;
