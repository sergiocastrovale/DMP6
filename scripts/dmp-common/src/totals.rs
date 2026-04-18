use sqlx::PgPool;

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
