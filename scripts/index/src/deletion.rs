use common::config::Config;
use common::error_log::log_warn;
use common::filters::escape_like;
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
}

// If more than this fraction of a folder's known tracks appear missing in one pass, treat it as a
// transient mount blip (NFS/CIFS stall, permission hiccup) rather than a real mass deletion, and skip
// deleting anything for this folder this run. A real deletion of a few bonus tracks stays well under
// this; losing every file at once is the signature of the mount, not the music, going away.
const MAX_MISSING_RATIO: f64 = 0.2;

/// Delete track rows whose filePath no longer exists on disk.
/// Returns count deleted and which releases were affected.
pub async fn delete_removed_tracks(
    pool: &PgPool,
    folder_prefix: &str,
    music_dir: &str,
) -> TrackDeletionResult {
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, "filePath", "localReleaseId" FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
    )
    .bind(format!("{}%", escape_like(folder_prefix)))
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let total = rows.len();
    let base = Path::new(music_dir);
    let mut missing_ids: Vec<String> = Vec::new();
    let mut release_ids: HashSet<String> = HashSet::new();

    for (id, path, release_id) in rows {
        if !base.join(&path).exists() {
            missing_ids.push(id);
            if let Some(rid) = release_id {
                release_ids.insert(rid);
            }
        }
    }

    if missing_ids.is_empty() {
        return TrackDeletionResult { count: 0 };
    }

    if total > 0 && missing_ids.len() as f64 / total as f64 > MAX_MISSING_RATIO {
        log_warn(&format!(
            "delete_removed_tracks: {}/{} tracks missing under '{}' - looks like a mount blip, not a real deletion. Skipping this folder.",
            missing_ids.len(), total, folder_prefix
        ));
        return TrackDeletionResult { count: 0 };
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

    TrackDeletionResult { count }
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

pub async fn delete_orphaned_mb_releases(pool: &PgPool) -> u64 {
    let result = sqlx::query(
        r#"DELETE FROM "MusicBrainzRelease"
           WHERE id NOT IN (SELECT DISTINCT "releaseId" FROM "LocalRelease" WHERE "releaseId" IS NOT NULL)
             AND status != 'MISSING'"#,
    )
    .execute(pool)
    .await;
    result.map(|r| r.rows_affected()).unwrap_or(0)
}

/// Delete Artist rows with no link left in ANY of the three link tables. Cleans images first.
///
/// `TrackRelatedArtist` must be one of the three: an MB-verified credit artist ("appears on" only -
/// Count Basie guesting on a Sinatra album without owning a release here) is a legitimate row whose
/// *only* link is a credit. Leaving that table out deletes every such artist the run just created and
/// cascades their credits away - the exact data-loss bug this pass once shipped. Mirrors the orphan
/// rule in `audit`'s scripts/audit/src/orphans.rs.
pub async fn delete_orphan_artists(pool: &PgPool, config: &Config) -> u64 {
    let ids: Vec<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "Artist" WHERE "primaryArtistId" IS NULL
           AND id NOT IN (
               SELECT DISTINCT "artistId" FROM "LocalReleaseArtist"
           ) AND id NOT IN (
               SELECT DISTINCT "artistId" FROM "MusicBrainzReleaseArtist"
           ) AND id NOT IN (
               SELECT DISTINCT "artistId" FROM "TrackRelatedArtist"
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

    let total_known = rows.len();
    let missing_folders: Vec<String> = rows
        .into_iter()
        .map(|(f,)| f)
        .filter(|f| !scanned_folders.contains(f))
        .collect();

    if total_known > 0 && missing_folders.len() as f64 / total_known as f64 > MAX_MISSING_RATIO {
        log_warn(&format!(
            "detect_deleted_folders: {}/{} known folders missing from this scan - looks like a mount blip, not a real mass deletion. Skipping folder-level deletion this run.",
            missing_folders.len(), total_known
        ));
        return stats;
    }

    for db_folder in missing_folders {
        let deleted = delete_folder_tracks(pool, &db_folder).await;
        stats.tracks_deleted += deleted;
    }

    if stats.tracks_deleted > 0 {
        stats.releases_deleted = delete_empty_releases(pool, config).await;
        stats.artists_deleted = delete_orphan_artists(pool, config).await;
    }

    stats
}

async fn delete_folder_tracks(pool: &PgPool, folder: &str) -> u64 {
    let result = sqlx::query(r#"DELETE FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#)
        .bind(format!("{}/%", escape_like(folder)))
        .execute(pool)
        .await;
    result.map(|r| r.rows_affected()).unwrap_or(0)
}
