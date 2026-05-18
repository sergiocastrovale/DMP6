use cuid2::create_id;
use sqlx::PgPool;

pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    sqlx::query(r#"DELETE FROM "IssueOrphanArtist""#)
        .execute(pool)
        .await?;

    // Phantom: names that are clearly corrupted (numeric garbage, bitrate markers)
    let phantom: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "Artist" WHERE (name ~ '^\d{1,3}$' OR name ~ '@\d{2,3}$') AND name NOT IN ('3', '311')"#,
    )
    .fetch_all(pool)
    .await?;

    // No releases: fully disconnected artists — no local releases, no MB releases, no track credits
    let no_releases: Vec<(String,)> = sqlx::query_as(
        r#"SELECT a.id FROM "Artist" a
           WHERE (NOT (name ~ '^\d{1,3}$' OR name ~ '@\d{2,3}$') OR name IN ('3', '311'))
             AND NOT EXISTS (SELECT 1 FROM "LocalReleaseArtist" lra WHERE lra."artistId" = a.id)
             AND NOT EXISTS (SELECT 1 FROM "TrackRelatedArtist" ta WHERE ta."artistId" = a.id)
             AND NOT EXISTS (SELECT 1 FROM "MusicBrainzReleaseArtist" mra WHERE mra."artistId" = a.id)"#,
    )
    .fetch_all(pool)
    .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    let groups: &[(&Vec<(String,)>, &str)] = &[
        (&phantom, "phantom"),
        (&no_releases, "no_releases"),
    ];

    for (artists, reason) in groups {
        for (artist_id,) in artists.iter() {
            let id = create_id();
            sqlx::query(
                r#"INSERT INTO "IssueOrphanArtist"
                   (id, "auditRunId", status, "artistId", reason, "createdAt", "updatedAt")
                   VALUES ($1, $2, 'DETECTED', $3, $4, $5, $5)"#,
            )
            .bind(&id)
            .bind(run_id)
            .bind(artist_id)
            .bind(*reason)
            .bind(now)
            .execute(pool)
            .await?;
            inserted += 1;
        }
    }

    Ok(inserted)
}
