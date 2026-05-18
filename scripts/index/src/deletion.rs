use chrono::NaiveDateTime;
use common::config::Config;
use common::images::{delete_artist_images, delete_release_images};
use sqlx::PgPool;
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Default)]
pub struct DeletionStats {
    pub tracks_deleted: u64,
    pub releases_deleted: u64,
    pub artists_deleted: u64,
}

pub struct TrackDeletionResult {
    pub count: u64,
    pub affected_release_ids: Vec<String>,
}

/// Delete track rows whose filePath no longer exists on disk.
/// Returns count deleted and which releases were affected.
pub async fn delete_removed_tracks(pool: &PgPool, folder_prefix: &str, music_dir: &str) -> TrackDeletionResult {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        r#"SELECT id, "filePath", "localReleaseId" FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
    )
    .bind(format!("{}%", folder_prefix))
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let base = Path::new(music_dir);
    let mut missing_ids: Vec<String> = Vec::new();
    let mut release_ids: HashSet<String> = HashSet::new();

    for (id, path, release_id) in rows {
        if !base.join(&path).exists() {
            missing_ids.push(id);
            release_ids.insert(release_id);
        }
    }

    if missing_ids.is_empty() {
        return TrackDeletionResult { count: 0, affected_release_ids: vec![] };
    }

    let count = missing_ids.len() as u64;
    sqlx::query(r#"DELETE FROM "LocalReleaseTrack" WHERE id = ANY($1::text[])"#)
        .bind(&missing_ids)
        .execute(pool)
        .await
        .ok();

    let affected: Vec<String> = release_ids.into_iter().collect();

    // Reset matchStatus so sync recalculates
    if !affected.is_empty() {
        sqlx::query(
            r#"UPDATE "LocalRelease"
               SET "matchStatus" = 'UNKNOWN'::"ReleaseStatus", "statusReason" = NULL
               WHERE id = ANY($1::text[])"#,
        )
        .bind(&affected)
        .execute(pool)
        .await
        .ok();
    }

    TrackDeletionResult { count, affected_release_ids: affected }
}

/// Delete LocalRelease rows that have no tracks left. Cleans images (local + S3) first.
/// Also deletes orphan MusicBrainzRelease rows that no LocalRelease references anymore.
pub async fn delete_empty_releases(pool: &PgPool, config: &Config) -> u64 {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, "releaseId" FROM "LocalRelease" WHERE id NOT IN (
               SELECT DISTINCT "localReleaseId" FROM "LocalReleaseTrack"
           )"#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if rows.is_empty() {
        return 0;
    }

    let release_ids: Vec<String> = rows.iter().map(|(id, _)| id.clone()).collect();
    let mb_release_ids: Vec<String> = rows.iter().filter_map(|(_, mb)| mb.clone()).collect();

    delete_release_images(pool, config, &release_ids).await;

    let result = sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1::text[])"#)
        .bind(&release_ids)
        .execute(pool)
        .await;
    let deleted = result.map(|r| r.rows_affected()).unwrap_or(0);

    // Clean up MB releases that no LocalRelease points to anymore
    if !mb_release_ids.is_empty() {
        sqlx::query(
            r#"DELETE FROM "MusicBrainzRelease"
               WHERE id = ANY($1::text[])
                 AND id NOT IN (SELECT DISTINCT "releaseId" FROM "LocalRelease" WHERE "releaseId" IS NOT NULL)"#,
        )
        .bind(&mb_release_ids)
        .execute(pool)
        .await
        .ok();
    }

    deleted
}

/// Delete Artist rows that have no LocalReleaseArtist links remaining. Cleans images first.
pub async fn delete_orphan_artists(pool: &PgPool, config: &Config) -> u64 {
    let ids: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "Artist" WHERE id NOT IN (
               SELECT DISTINCT "artistId" FROM "LocalReleaseArtist"
           ) AND id NOT IN (
               SELECT DISTINCT "artistId" FROM "MusicBrainzReleaseArtist"
           )"#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if ids.is_empty() {
        return 0;
    }

    let artist_ids: Vec<String> = ids.into_iter().map(|(id,)| id).collect();
    delete_artist_images(pool, config, &artist_ids).await;

    let result = sqlx::query(r#"DELETE FROM "Artist" WHERE id = ANY($1::text[])"#)
        .bind(&artist_ids)
        .execute(pool)
        .await;
    result.map(|r| r.rows_affected()).unwrap_or(0)
}

/// After indexing all folders, find folders that were previously indexed but
/// are no longer present in the current scan run. Delete their tracks and
/// cascade-clean empty releases and orphan artists.
pub async fn detect_deleted_folders(
    pool: &PgPool,
    scanned_folders: &HashSet<String>,
    config: &Config,
) -> DeletionStats {
    // Load all distinct folder prefixes that have tracks in the DB
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT SPLIT_PART("filePath", '/', 1) AS folder FROM "LocalReleaseTrack""#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut stats = DeletionStats::default();

    for (db_folder,) in rows {
        if !scanned_folders.contains(&db_folder) {
            let deleted = delete_folder_tracks(pool, &db_folder).await;
            stats.tracks_deleted += deleted;
        }
    }

    if stats.tracks_deleted > 0 {
        stats.releases_deleted = delete_empty_releases(pool, config).await;
        stats.artists_deleted = delete_orphan_artists(pool, config).await;
    }

    stats
}

async fn delete_folder_tracks(pool: &PgPool, folder: &str) -> u64 {
    let result = sqlx::query(
        r#"DELETE FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
    )
    .bind(format!("{}/%", folder))
    .execute(pool)
    .await;
    result.map(|r| r.rows_affected()).unwrap_or(0)
}

/// Check if a folder's mtime has changed since last scan.
/// Returns true if the folder is new or modified.
pub fn folder_changed(
    folder_path: &Path,
    known_scans: &std::collections::HashMap<String, NaiveDateTime>,
    folder_key: &str,
) -> bool {
    let Ok(meta) = std::fs::metadata(folder_path) else { return true };
    let Ok(sys_mtime) = meta.modified() else { return true };
    let Ok(dur) = sys_mtime.duration_since(std::time::UNIX_EPOCH) else { return true };
    let Some(disk_mtime) = chrono::DateTime::from_timestamp(dur.as_secs() as i64, 0)
        .map(|dt| dt.naive_utc()) else { return true };
    match known_scans.get(folder_key) {
        Some(cached) => (disk_mtime - *cached).num_seconds().abs() > 1,
        None => true,
    }
}
