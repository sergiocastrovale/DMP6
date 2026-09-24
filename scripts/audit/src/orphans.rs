use cuid2::create_id;
use sqlx::PgPool;

/// One transaction for the whole pass: without it, a crash between the DELETE and the last INSERT
/// would leave the DETECTED set empty/partial until the next run re-derives it (PENDING/RESOLVED/
/// FAILED rows are untouched either way, so nothing is permanently lost) and a run that dies
/// partway would silently under-report instead of reporting none.
pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueOrphanArtist" WHERE status = 'DETECTED'"#)
        .execute(&mut *tx)
        .await?;

    // Phantom: names that are clearly corrupted (numeric garbage, bitrate markers)
    let phantom: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "Artist"
           WHERE (name ~ '^\d{1,3}$' OR name ~ '@\d{2,3}$') AND name <> ALL($1::text[])"#,
    )
    .bind(common::artists::KNOWN_NUMERIC_ARTIST_NAMES)
    .fetch_all(&mut *tx)
    .await?;

    // Fully disconnected artists - no local releases, no MB releases, AND no track credits. An
    // MB-verified credit artist ("appears on" only, owning nothing here) is a legitimate row whose
    // sole link is a TrackRelatedArtist credit, so that table has to be checked too or the audit
    // proposes deleting every one of them. Same rule as index's own cleanup
    // (scripts/index/src/deletion.rs). `manuallyAdded` (./add) is excluded too, for the same reason
    // as there - must match.
    let no_releases: Vec<(String,)> = sqlx::query_as(
        r#"SELECT a.id FROM "Artist" a
           WHERE (NOT (name ~ '^\d{1,3}$' OR name ~ '@\d{2,3}$') OR name = ANY($1::text[]))
             AND a."primaryArtistId" IS NULL
             AND NOT a."manuallyAdded"
             AND NOT EXISTS (SELECT 1 FROM "LocalReleaseArtist" lra WHERE lra."artistId" = a.id)
             AND NOT EXISTS (SELECT 1 FROM "TrackRelatedArtist" tra WHERE tra."artistId" = a.id)
             AND NOT EXISTS (SELECT 1 FROM "MusicBrainzReleaseArtist" mra WHERE mra."artistId" = a.id)"#,
    )
    .bind(common::artists::KNOWN_NUMERIC_ARTIST_NAMES)
    .fetch_all(&mut *tx)
    .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    let groups: &[(&Vec<(String,)>, &str)] =
        &[(&phantom, "phantom"), (&no_releases, "no_releases")];

    // One read for every already-tracked artist instead of a round trip per candidate below.
    let candidate_ids: Vec<&str> = phantom
        .iter()
        .chain(no_releases.iter())
        .map(|(id,)| id.as_str())
        .collect();
    let already_tracked_ids: std::collections::HashSet<String> = sqlx::query_scalar(
        r#"SELECT "artistId" FROM "IssueOrphanArtist"
           WHERE "artistId" = ANY($1::text[]) AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED')"#,
    )
    .bind(&candidate_ids)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();

    for (artists, reason) in groups {
        for (artist_id,) in artists.iter() {
            if already_tracked_ids.contains(artist_id) {
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
            .execute(&mut *tx)
            .await?;
            inserted += 1;
        }
    }

    tx.commit().await?;
    Ok(inserted)
}
