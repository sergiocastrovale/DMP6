use chrono::Utc;
use sqlx::PgPool;
use std::collections::HashSet;

// Cleanup: delete MusicBrainzRelease rows no LocalRelease points to
// ---------------------------------------------------------------------------

/// Artist ids this run is allowed to clean up after, or `None` for the whole library.
///
/// A `--only`/`--artist-ids`/`--release` run must not garbage-collect rows for artists it never
/// synced. The MB variant below is the reason this type exists: unscoped, a one-artist sync deletes
/// every non-MISSING `MusicBrainzRelease` in the library that happens to be unbound at that instant -
/// including a perfectly real release whose `LocalRelease` index had just regrouped, for an artist the
/// run never looked at. Only an unfiltered run has the whole picture.
pub type ArtistScope<'a> = Option<&'a [String]>;

/// Rebuild `MusicBrainzReleaseMedium` rows and `mediumCount` for releases that predate them, from the
/// disc numbers their own tracks already carry. Pure SQL, no MusicBrainz call, idempotent: once a release
/// has medium rows it is never selected again.
///
/// Discs were first modelled on 2026-09-06/07 (the `box_sets`/`multidisk` migrations). Those migrations
/// defaulted `mediumCount` to 1 and never backfilled existing releases, so everything synced 2026-08-31 to
/// 09-06 and not re-synced since kept `mediumCount = 1` and no medium rows - while its tracks carried disc
/// numbers 1, 2, ... all along. Measured on 2026-09-18: 3,602 releases. Nothing writes this shape today;
/// sync's binding path records media properly.
///
/// It matters because every multi-disc decision keys off `mediumCount > 1`: such a release is invisible
/// to the box pass, and each disc folder bound to it is scored against the *whole* multi-disc tracklist -
/// 1,745 local releases `MISSING_TRACKS` purely for that reason (docs/specs/spec_tidy_observations.md §15).
///
/// Only releases where **every** track has a disc number and there are at least two distinct ones. A
/// release with a single disc number is a genuine single medium and is left exactly as it is. Medium
/// titles and formats are not recoverable from tracks and stay NULL; nothing downstream requires them
/// (the containment tier of `box_editions` simply skips an untitled medium).
pub async fn backfill_media_from_track_discs(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let now = Utc::now().naive_utc();
    let mut tx = pool.begin().await?;
    let targets: Vec<String> = sqlx::query_scalar(
        r#"SELECT r.id FROM "MusicBrainzRelease" r
           WHERE NOT EXISTS (SELECT 1 FROM "MusicBrainzReleaseMedium" md WHERE md."releaseId" = r.id)
             AND NOT EXISTS (SELECT 1 FROM "MusicBrainzReleaseTrack" t
                             WHERE t."releaseId" = r.id AND t."discNumber" IS NULL)
             AND (SELECT count(DISTINCT t."discNumber") FROM "MusicBrainzReleaseTrack" t
                  WHERE t."releaseId" = r.id) > 1"#,
    )
    .fetch_all(&mut *tx)
    .await?;
    if targets.is_empty() {
        tx.commit().await?;
        return Ok(0);
    }
    sqlx::query(
        r#"INSERT INTO "MusicBrainzReleaseMedium" (id, "releaseId", position, "trackCount", "createdAt", "updatedAt")
           SELECT md5(t."releaseId" || ':' || t."discNumber"), t."releaseId", t."discNumber", count(*), $2, $2
           FROM "MusicBrainzReleaseTrack" t
           WHERE t."releaseId" = ANY($1)
           GROUP BY t."releaseId", t."discNumber"
           ON CONFLICT ("releaseId", position) DO NOTHING"#,
    )
    .bind(&targets)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE "MusicBrainzRelease" r
           SET "mediumCount" = (SELECT count(DISTINCT t."discNumber") FROM "MusicBrainzReleaseTrack" t
                                WHERE t."releaseId" = r.id),
               "updatedAt" = $2
           WHERE r.id = ANY($1)"#,
    )
    .bind(&targets)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(targets.len() as u64)
}

/// Sync/tidy entry point for [`common::cleanup::delete_orphaned_mb_releases`], scoped by artist.
/// Must run before `retire_owned_missing_placeholders` at every call site.
pub async fn delete_orphaned_mb_releases(
    pool: &PgPool,
    scope: ArtistScope<'_>,
) -> Result<u64, sqlx::Error> {
    let scope = match scope {
        Some(artist_ids) => common::cleanup::MbSweepScope::Artists(artist_ids),
        None => common::cleanup::MbSweepScope::All,
    };
    common::cleanup::delete_orphaned_mb_releases(pool, scope).await
}

/// Scoped to releases owned by `scope`'s artists. An *ownerless* empty release is left to the global
/// pass - nothing attributes it to the artists this run synced.
pub async fn delete_empty_local_releases(
    pool: &PgPool,
    scope: ArtistScope<'_>,
) -> Result<u64, sqlx::Error> {
    let result = match scope {
        Some(artist_ids) => {
            sqlx::query(
                r#"DELETE FROM "LocalRelease" lr
                   WHERE NOT EXISTS (
                           SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id
                         )
                     AND EXISTS (
                           SELECT 1 FROM "LocalReleaseArtist" lra
                           WHERE lra."localReleaseId" = lr.id AND lra."artistId" = ANY($1::text[])
                         )"#,
            )
            .bind(artist_ids)
            .execute(pool)
            .await?
        }
        None => {
            sqlx::query(
                r#"DELETE FROM "LocalRelease" lr
                   WHERE NOT EXISTS (
                       SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id
                   )"#,
            )
            .execute(pool)
            .await?
        }
    };
    Ok(result.rows_affected())
}

// Never delete a MISSING placeholder that a live DownloadedRelease still points at — the web app's
// auto-downloader keys its dedup/retry logic off that row, so dropping it orphans the queue entry and
// lets the trickle worker re-fetch the same release as if it were brand new.
//
// "Live" is the states that can still consume the target (DOWNLOADING/ENRICHING/READY/PROMOTED). The
// dead ends (REJECTED, FAILED, ABANDONED, UNAVAILABLE, INVALID) must not pin it too, or a gap the
// catalogue filter now rejects could never be swept - a rejected download's row would keep a bogus
// MISSING entry alive through every re-sync. Orphaning those is safe - `acquire.post.ts` dedups on
// the stable `releaseGroupId` whenever there is one, and every gap row carries it.
pub async fn delete_missing_releases_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"DELETE FROM "MusicBrainzRelease"
           WHERE status = 'MISSING'
             AND id IN (
               SELECT "releaseId" FROM "MusicBrainzReleaseArtist"
               WHERE "artistId" = $1
             )
             AND id NOT IN (
               SELECT "mbReleaseId" FROM "DownloadedRelease"
               WHERE "mbReleaseId" IS NOT NULL
                 AND status IN ('DOWNLOADING', 'ENRICHING', 'READY', 'PROMOTED')
             )"#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

// Cover set = this artist + every connected (duplicate-merged) artist, matching the web artist page's
// own aggregation (releases.get.ts's allArtistIds = primary + Artist.findMany({primaryArtistId})).
// Without this, a release owned only under a connected artist's LocalReleaseArtist link stayed
// "uncovered" here, so catalogue-gaps created a MISSING placeholder and the trickle worker
// re-downloaded an album the library already had (landing under the connected artist's folder).
/// Errors propagate: an empty set would turn every owned album into a MISSING gap.
pub async fn get_covered_release_group_ids(
    pool: &PgPool,
    artist_id: &str,
) -> Result<HashSet<String>, sqlx::Error> {
    // Two ways a group counts as owned:
    //   1. a LocalRelease is bound to one of its releases (the ordinary case), or
    //   2. it is a dissolved box (docs/sync_decisions.md): a box's own release has no bind
    //      on its own release group once its discs are dissolved onto their equivalent albums, so
    //      without this branch every dissolved box reads MISSING and gets re-downloaded whole. A
    //      multi-medium release counts covered when EVERY one of its media is covered — bound at
    //      that mediumPosition directly, OR its equivalentReleaseId itself has a bind, OR a
    //      LocalRelease carries boxReleaseId/boxMediumPosition pointing at it (a rarities disc bound
    //      straight to the box).
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT mbr."releaseGroupId"
           FROM "MusicBrainzRelease" mbr
           JOIN "LocalRelease" lr ON lr."releaseId" = mbr.id
           JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
           JOIN "Artist" a ON a.id = lra."artistId"
           WHERE (lra."artistId" = $1 OR a."primaryArtistId" = $1)
             AND mbr."releaseGroupId" IS NOT NULL
           UNION
           SELECT DISTINCT mbr."releaseGroupId"
           FROM "MusicBrainzRelease" mbr
           JOIN "MusicBrainzReleaseArtist" mra3 ON mra3."releaseId" = mbr.id
           JOIN "Artist" a3 ON a3.id = mra3."artistId"
           WHERE (mra3."artistId" = $1 OR a3."primaryArtistId" = $1)
             AND mbr."releaseGroupId" IS NOT NULL
             AND mbr."mediumCount" > 1
             AND NOT EXISTS (
               SELECT 1 FROM "MusicBrainzReleaseMedium" m
               WHERE m."releaseId" = mbr.id
                 AND NOT (
                   EXISTS (
                     SELECT 1 FROM "LocalRelease" lr2
                     WHERE lr2."releaseId" = mbr.id AND lr2."mediumPosition" = m.position
                   )
                   OR (
                     m."equivalentReleaseId" IS NOT NULL
                     AND EXISTS (
                       SELECT 1 FROM "LocalRelease" lr3 WHERE lr3."releaseId" = m."equivalentReleaseId"
                     )
                   )
                   OR EXISTS (
                     SELECT 1 FROM "LocalRelease" lr4
                     WHERE lr4."boxReleaseId" = mbr.id AND lr4."boxMediumPosition" = m.position
                   )
                 )
             )"#,
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}
