use cuid2::create_id;
use sqlx::PgPool;

pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueOrphanArtist" WHERE status = 'DETECTED'"#)
        .execute(pool)
        .await?;

    // Phantom: names that are clearly corrupted (numeric garbage, bitrate markers)
    let phantom: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "Artist" WHERE (name ~ '^\d{1,3}$' OR name ~ '@\d{2,3}$') AND name NOT IN ('3', '311')"#,
    )
    .fetch_all(pool)
    .await?;

    // Fully disconnected artists - no local releases, no MB releases, AND no track credits. An
    // MB-verified credit artist ("appears on" only, owning nothing here) is a legitimate row whose
    // sole link is a TrackRelatedArtist credit, so that table has to be checked too or the audit
    // proposes deleting every one of them. Same rule as index's own cleanup
    // (scripts/index/src/deletion.rs).
    let no_releases: Vec<(String,)> = sqlx::query_as(
        r#"SELECT a.id FROM "Artist" a
           WHERE (NOT (name ~ '^\d{1,3}$' OR name ~ '@\d{2,3}$') OR name IN ('3', '311'))
             AND a."primaryArtistId" IS NULL
             AND NOT EXISTS (SELECT 1 FROM "LocalReleaseArtist" lra WHERE lra."artistId" = a.id)
             AND NOT EXISTS (SELECT 1 FROM "TrackRelatedArtist" tra WHERE tra."artistId" = a.id)
             AND NOT EXISTS (SELECT 1 FROM "MusicBrainzReleaseArtist" mra WHERE mra."artistId" = a.id)"#,
    )
    .fetch_all(pool)
    .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    let groups: &[(&Vec<(String,)>, &str)] =
        &[(&phantom, "phantom"), (&no_releases, "no_releases")];

    for (artists, reason) in groups {
        for (artist_id,) in artists.iter() {
            let already_tracked: bool = sqlx::query_scalar(
                r#"SELECT EXISTS(SELECT 1 FROM "IssueOrphanArtist"
                   WHERE "artistId" = $1 AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED'))"#,
            )
            .bind(artist_id)
            .fetch_one(pool)
            .await?;
            if already_tracked {
                continue;
            }

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
