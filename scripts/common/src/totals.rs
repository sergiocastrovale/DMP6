use sqlx::PgPool;

// Completeness = fully-COMPLETE album/EP releases / determinable album/EP catalogue.
// UNKNOWN/UNMATCHED releases are excluded entirely (as if they don't exist yet - no verdict to
// count either way); every other status (COMPLETE, INCOMPLETE, EXTRA_TRACKS, MISSING_TRACKS,
// MISSING) counts toward the denominator, but only COMPLETE counts toward the numerator - a
// MISSING_TRACKS or INCOMPLETE release is matched but not actually complete, and must not inflate
// the score the way "anything but MISSING" used to. NULL when there is no determinable catalogue.
// Pure SQL over the MB catalogue - no track/file scan, no API calls. Lives in `common` (not
// `sync`, a bin-only crate) so `delete --release` can recompute an owner's completeness too, after
// dropping a release changes nothing about their MB catalogue size but can flip a MISSING gap back
// into existence.
pub async fn recompute_artist_completeness(
    pool: &PgPool,
    artist_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "Artist" a
           SET "completeness" = sub.completeness, "updatedAt" = NOW()
           FROM (
             SELECT CASE WHEN COUNT(*) = 0 THEN NULL
                         ELSE COUNT(*) FILTER (WHERE mr.status::text = 'COMPLETE')::float8 / COUNT(*)
                    END AS completeness
             FROM "MusicBrainzReleaseArtist" mra
             JOIN "MusicBrainzRelease" mr ON mr.id = mra."releaseId"
             JOIN "ReleaseType" rt ON rt.id = mr."typeId"
             WHERE mra."artistId" = $1 AND rt.slug IN ('album', 'ep')
               AND mr.status::text NOT IN ('UNKNOWN', 'UNMATCHED')
           ) sub
           WHERE a.id = $1"#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_release_totals_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"UPDATE "LocalRelease" lr SET
             "totalDuration" = sub.total_dur,
             "totalFileSize" = sub.total_size,
             "updatedAt" = NOW()
           FROM (
             SELECT "localReleaseId",
                    COALESCE(SUM(duration), 0) as total_dur,
                    COALESCE(SUM("fileSize"), 0) as total_size
             FROM "LocalReleaseTrack"
             WHERE "localReleaseId" IS NOT NULL
             GROUP BY "localReleaseId"
           ) sub
           WHERE lr.id = sub."localReleaseId"
             AND lr.id IN (SELECT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = $1)"#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Zeroes `totalTracks`/`totalFileSize` for artists in `artist_ids` that own no `LocalRelease` at all.
/// `update_artist_totals_for_artist`'s `UPDATE ... FROM` only matches artist ids the subquery's INNER
/// JOINs actually produce a row for - an artist a delete just emptied out produces none, so its stale
/// totals from before the delete would otherwise survive untouched.
pub async fn zero_totals_for_ownerless_artists(
    pool: &PgPool,
    artist_ids: &[String],
) -> Result<u64, sqlx::Error> {
    if artist_ids.is_empty() {
        return Ok(0);
    }
    let result = sqlx::query(
        r#"UPDATE "Artist" a SET "totalTracks" = 0, "totalFileSize" = 0, "updatedAt" = NOW()
           WHERE a.id = ANY($1::text[])
             AND NOT EXISTS (SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = a.id)"#,
    )
    .bind(artist_ids)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

pub async fn update_artist_totals_for_artist(
    pool: &PgPool,
    artist_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"UPDATE "Artist" a SET
             "totalTracks" = sub.track_count,
             "totalFileSize" = sub.total_size,
             "updatedAt" = NOW()
           FROM (
             SELECT lra."artistId",
                    COUNT(DISTINCT lrt.id)::int as track_count,
                    COALESCE(SUM(DISTINCT lrt."fileSize"), 0) as total_size
             FROM "LocalReleaseTrack" lrt
             JOIN "LocalRelease" lr ON lrt."localReleaseId" = lr.id
             JOIN "LocalReleaseArtist" lra ON lr.id = lra."localReleaseId"
             WHERE lra."artistId" = $1
             GROUP BY lra."artistId"
           ) sub
           WHERE a.id = sub."artistId""#,
    )
    .bind(artist_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}
