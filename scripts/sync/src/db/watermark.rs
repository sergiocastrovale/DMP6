use chrono::NaiveDateTime;
use sqlx::PgPool;

// Tidy watermark (Artist.lastTidiedAt)
// ---------------------------------------------------------------------------

/// Artist (id, name) pairs tidy has fresh work for: synced at least once, and either never tidied or
/// synced again since its last tidy. `lastSyncedAt IS NOT NULL` excludes an artist sync has not reached
/// yet - tidy runs after sync in every caller, never instead of it. Names come along so `--only`/
/// `--from`/`--to` can narrow this set the same way sync's own filters do.
pub async fn get_artists_pending_tidy(pool: &PgPool) -> Result<Vec<(String, String)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, name FROM "Artist"
           WHERE "lastSyncedAt" IS NOT NULL
             AND ("lastTidiedAt" IS NULL OR "lastSyncedAt" > "lastTidiedAt")
           ORDER BY name"#,
    )
    .fetch_all(pool)
    .await
}

/// Every artist (id, name) sync has ever reached, for `--all` (which ignores the watermark, but can
/// still be narrowed further by `--only`/`--from`/`--to` the same way the watermark set can).
pub async fn get_all_synced_artists(pool: &PgPool) -> Result<Vec<(String, String)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, name FROM "Artist" WHERE "lastSyncedAt" IS NOT NULL ORDER BY name"#,
    )
    .fetch_all(pool)
    .await
}

/// Stamp `lastTidiedAt` for exactly the artists this run scoped and finished clean. Never called for a
/// run that was interrupted or hit a phase error - those artists must stay pending so the next tidy
/// redoes them (docs/specs/spec_tidy_script.md "Watermark traps").
pub async fn stamp_artists_tidied(
    pool: &PgPool,
    artist_ids: &[String],
    at: NaiveDateTime,
) -> Result<(), sqlx::Error> {
    if artist_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(r#"UPDATE "Artist" SET "lastTidiedAt" = $1 WHERE id = ANY($2)"#)
        .bind(at)
        .bind(artist_ids)
        .execute(pool)
        .await?;
    Ok(())
}

/// `--all`: stamp every artist sync has ever reached, not just the ids this run happened to scope
/// (a whole-library run's scope is implicitly "every synced artist").
pub async fn stamp_all_tidied(pool: &PgPool, at: NaiveDateTime) -> Result<(), sqlx::Error> {
    sqlx::query(r#"UPDATE "Artist" SET "lastTidiedAt" = $1 WHERE "lastSyncedAt" IS NOT NULL"#)
        .bind(at)
        .execute(pool)
        .await?;
    Ok(())
}

/// Owning artist ids for a set of `LocalRelease` ids - step 8's score recompute must cover not just
/// the artists this run scoped, but every owner of a release the box pass or re-score actually
/// touched (a sibling group frequently spans more than one artist's folders).
pub async fn get_owner_artist_ids_for_releases(
    pool: &PgPool,
    local_release_ids: &[String],
) -> Result<Vec<String>, sqlx::Error> {
    if local_release_ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_scalar(
        r#"SELECT DISTINCT "artistId" FROM "LocalReleaseArtist" WHERE "localReleaseId" = ANY($1)"#,
    )
    .bind(local_release_ids)
    .fetch_all(pool)
    .await
}
