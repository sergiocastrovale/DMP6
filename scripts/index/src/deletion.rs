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

/// Delete track rows whose filePath no longer exists on disk.
/// Returns the count deleted.
pub async fn delete_removed_tracks(pool: &PgPool, folder_prefix: &str, music_dir: &str) -> u64 {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT id, "filePath" FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
    )
    .bind(format!("{}%", folder_prefix))
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let base = Path::new(music_dir);
    let missing: Vec<String> = rows
        .into_iter()
        .filter(|(_, path)| !base.join(path).exists())
        .map(|(id, _)| id)
        .collect();

    if missing.is_empty() {
        return 0;
    }

    let count = missing.len() as u64;
    sqlx::query(r#"DELETE FROM "LocalReleaseTrack" WHERE id = ANY($1::text[])"#)
        .bind(&missing)
        .execute(pool)
        .await
        .ok();
    count
}

/// Delete LocalRelease rows that have no tracks left. Cleans images (local + S3) first.
pub async fn delete_empty_releases(pool: &PgPool, config: &Config) -> u64 {
    let ids: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "LocalRelease" WHERE id NOT IN (
               SELECT DISTINCT "localReleaseId" FROM "LocalReleaseTrack"
           )"#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if ids.is_empty() {
        return 0;
    }

    let release_ids: Vec<String> = ids.into_iter().map(|(id,)| id).collect();
    delete_release_images(pool, config, &release_ids).await;

    let result = sqlx::query(r#"DELETE FROM "LocalRelease" WHERE id = ANY($1::text[])"#)
        .bind(&release_ids)
        .execute(pool)
        .await;
    result.map(|r| r.rows_affected()).unwrap_or(0)
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
