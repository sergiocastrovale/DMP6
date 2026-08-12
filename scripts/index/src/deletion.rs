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
    pub favorites_dropped: u64,
    pub playlists_dropped: u64,
}

pub struct TrackDeletionResult {
    pub count: u64,
    /// User-owned links that cascade away with the deleted rows. Counted, never re-linked: a replaced
    /// file is a new `LocalReleaseTrack` (filePath is the identity), so its favorite / playlist entries
    /// and playCount are gone. Reported so the run does not lose them silently.
    pub favorites_dropped: u64,
    pub playlists_dropped: u64,
}

/// The single line the web UI parses for the "dropped links" chip (`parseDroppedLinks` in
/// web/helpers/functions.ts). Keep the wording and both counts in sync with that parser.
pub fn dropped_links_line(favorites: u64, playlists: u64) -> String {
    format!(
        "WARN: dropped {} favourite(s) and {} playlist entry(ies) for removed files",
        favorites, playlists
    )
}

/// Counts the favorite / playlist rows pointing at `track_ids`, before those tracks are deleted.
async fn count_dropped_links(pool: &PgPool, track_ids: &[String]) -> (u64, u64) {
    let row: Option<(i64, i64)> = sqlx::query_as(
        r#"SELECT
             (SELECT COUNT(*) FROM "FavoriteTrack" WHERE "trackId" = ANY($1::text[])),
             (SELECT COUNT(*) FROM "PlaylistTrack" WHERE "trackId" = ANY($1::text[]))"#,
    )
    .bind(track_ids)
    .fetch_optional(pool)
    .await
    .unwrap_or_default();

    row.map(|(f, p)| (f as u64, p as u64)).unwrap_or((0, 0))
}

// If more than this fraction of a folder's known tracks appear missing in one pass, treat it as a
// transient mount blip (NFS/CIFS stall, permission hiccup) rather than a real mass deletion, and skip
// deleting anything for this folder this run. A real deletion of a few bonus tracks stays well under
// this; losing every file at once is the signature of the mount, not the music, going away.
const MAX_MISSING_RATIO: f64 = 0.2;

/// Delete track rows whose filePath no longer exists on disk.
/// Returns count deleted and which releases were affected.
///
/// `force` (`./index --prune`) skips the ratio guard. Its call site only sets it for a folder this run
/// just walked and found audio files in - the mount is provably up, so a missing file is a real
/// deletion no matter what fraction of the folder it represents. That is the case a wholesale folder
/// swap (old rip removed, new one dropped in) always lands in, and the guard would otherwise strand
/// every old row forever.
pub async fn delete_removed_tracks(
    pool: &PgPool,
    folder_prefix: &str,
    music_dir: &str,
    force: bool,
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
        return TrackDeletionResult {
            count: 0,
            favorites_dropped: 0,
            playlists_dropped: 0,
        };
    }

    if !force && total > 0 && missing_ids.len() as f64 / total as f64 > MAX_MISSING_RATIO {
        log_warn(&format!(
            "delete_removed_tracks: {}/{} tracks missing under '{}' - looks like a mount blip, not a real deletion. Skipping this folder.",
            missing_ids.len(), total, folder_prefix
        ));
        return TrackDeletionResult {
            count: 0,
            favorites_dropped: 0,
            playlists_dropped: 0,
        };
    }

    let count = missing_ids.len() as u64;
    if force && total > 0 && count as f64 / total as f64 > MAX_MISSING_RATIO {
        println!(
            "  Pruning {}/{} track(s) missing under '{}' (--prune, ratio guard bypassed)",
            count, total, folder_prefix
        );
    }
    let (favorites_dropped, playlists_dropped) = count_dropped_links(pool, &missing_ids).await;

    sqlx::query(r#"DELETE FROM "LocalReleaseTrack" WHERE id = ANY($1::text[])"#)
        .bind(&missing_ids)
        .execute(pool)
        .await
        .ok();

    let affected: Vec<String> = release_ids.into_iter().collect();

    // Reset matchStatus so sync recalculates.
    //
    // `statusReason` is a MusicBrainzRelease column, not a LocalRelease one. Naming it here made the
    // whole statement fail, and `.ok()` swallowed the error - so no pruned release was ever flagged
    // and sync never recomputed any of them. Caught by `tests/prune_guard.rs`, which had been red.
    if !affected.is_empty() {
        sqlx::query(
            r#"UPDATE "LocalRelease"
               SET "matchStatus" = 'UNKNOWN'::"ReleaseStatus"
               WHERE id = ANY($1::text[])"#,
        )
        .bind(&affected)
        .execute(pool)
        .await
        .ok();
    }

    TrackDeletionResult {
        count,
        favorites_dropped,
        playlists_dropped,
    }
}

/// Artist ids a run is allowed to clean up after, or `None` for the whole library.
///
/// A filtered run (`--only`, `--folders`, `--from`/`--to`) must not garbage-collect rows belonging to
/// artists it never looked at: it has no idea whether those rows are genuinely orphaned or merely
/// mid-write by something else, and deleting them makes a one-artist rescan a library-wide mutation.
/// Only an unfiltered run has the whole picture, so only an unfiltered run sweeps globally.
pub type ArtistScope<'a> = Option<&'a [String]>;

/// Delete LocalRelease rows that have no tracks left. Cleans images (local + S3) first.
/// Also deletes orphan MusicBrainzRelease rows that no LocalRelease references anymore.
///
/// Scoped to releases owned by `scope`'s artists when it is `Some`. An *ownerless* empty release is
/// deliberately left to the global pass - nothing attributes it to the artists in scope.
pub async fn delete_empty_releases(pool: &PgPool, config: &Config, scope: ArtistScope<'_>) -> u64 {
    let rows: Vec<(String, Option<String>)> = match scope {
        Some(artist_ids) => sqlx::query_as(
            r#"SELECT lr.id, lr."releaseId" FROM "LocalRelease" lr
               WHERE NOT EXISTS (
                       SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id
                     )
                 AND EXISTS (
                       SELECT 1 FROM "LocalReleaseArtist" lra
                       WHERE lra."localReleaseId" = lr.id AND lra."artistId" = ANY($1::text[])
                     )"#,
        )
        .bind(artist_ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default(),
        None => sqlx::query_as(
            r#"SELECT lr.id, lr."releaseId" FROM "LocalRelease" lr
               WHERE NOT EXISTS (
                   SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id
               )"#,
        )
        .fetch_all(pool)
        .await
        .unwrap_or_default(),
    };

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
            r#"DELETE FROM "MusicBrainzRelease" m
               WHERE m.id = ANY($1::text[])
                 AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr WHERE lr."releaseId" = m.id)"#,
        )
        .bind(&mb_release_ids)
        .execute(pool)
        .await
        .ok();
    }

    deleted
}

/// Scoped to releases credited to `scope`'s artists when it is `Some`.
///
/// `NOT EXISTS` rather than the old `NOT IN (... WHERE "releaseId" IS NOT NULL)`: `NOT IN` over a
/// nullable column yields UNKNOWN for every row the moment one NULL slips into the subquery, which is
/// what that `IS NOT NULL` guard was there to paper over. `NOT EXISTS` has no such trap and plans
/// better as an anti-join.
pub async fn delete_orphaned_mb_releases(pool: &PgPool, scope: ArtistScope<'_>) -> u64 {
    let result = match scope {
        Some(artist_ids) => {
            sqlx::query(
                r#"DELETE FROM "MusicBrainzRelease" m
                   WHERE m.status <> 'MISSING'
                     AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr WHERE lr."releaseId" = m.id)
                     AND EXISTS (
                           SELECT 1 FROM "MusicBrainzReleaseArtist" mra
                           WHERE mra."releaseId" = m.id AND mra."artistId" = ANY($1::text[])
                         )"#,
            )
            .bind(artist_ids)
            .execute(pool)
            .await
        }
        None => {
            sqlx::query(
                r#"DELETE FROM "MusicBrainzRelease" m
                   WHERE m.status <> 'MISSING'
                     AND NOT EXISTS (SELECT 1 FROM "LocalRelease" lr WHERE lr."releaseId" = m.id)"#,
            )
            .execute(pool)
            .await
        }
    };
    result.map(|r| r.rows_affected()).unwrap_or(0)
}

/// Delete Artist rows with no link left in ANY of the three link tables. Cleans images first.
///
/// `TrackRelatedArtist` must be one of the three: an MB-verified credit artist ("appears on" only -
/// Count Basie guesting on a Sinatra album without owning a release here) is a legitimate row whose
/// *only* link is a credit. Leaving that table out deletes every such artist the run just created and
/// cascades their credits away - the exact data-loss bug this pass once shipped. Mirrors the orphan
/// rule in `audit`'s scripts/audit/src/orphans.rs.
/// Scoped to `scope`'s own artist ids when it is `Some` - a filtered run may retire an artist it just
/// emptied, never one it never looked at.
pub async fn delete_orphan_artists(pool: &PgPool, config: &Config, scope: ArtistScope<'_>) -> u64 {
    const UNLINKED: &str = r#"a."primaryArtistId" IS NULL
           AND NOT EXISTS (SELECT 1 FROM "LocalReleaseArtist" x WHERE x."artistId" = a.id)
           AND NOT EXISTS (SELECT 1 FROM "MusicBrainzReleaseArtist" x WHERE x."artistId" = a.id)
           AND NOT EXISTS (SELECT 1 FROM "TrackRelatedArtist" x WHERE x."artistId" = a.id)"#;

    let ids: Vec<(String,)> = match scope {
        Some(artist_ids) => sqlx::query_as(&format!(
            r#"SELECT a.id FROM "Artist" a WHERE a.id = ANY($1::text[]) AND {}"#,
            UNLINKED
        ))
        .bind(artist_ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default(),
        None => sqlx::query_as(&format!(r#"SELECT a.id FROM "Artist" a WHERE {}"#, UNLINKED))
            .fetch_all(pool)
            .await
            .unwrap_or_default(),
    };

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
        stats.tracks_deleted += deleted.count;
        stats.favorites_dropped += deleted.favorites_dropped;
        stats.playlists_dropped += deleted.playlists_dropped;
    }

    if stats.tracks_deleted > 0 {
        // Unscoped on purpose: this pass only ever runs on an unfiltered scan (see the `!has_filter`
        // gate at its call site), which is exactly the run that is entitled to sweep globally.
        stats.releases_deleted = delete_empty_releases(pool, config, None).await;
        stats.artists_deleted = delete_orphan_artists(pool, config, None).await;
    }

    stats
}

async fn delete_folder_tracks(pool: &PgPool, folder: &str) -> TrackDeletionResult {
    let prefix = format!("{}/%", escape_like(folder));

    // Ids first: the favorite/playlist counts have to be read while the rows still exist.
    let ids: Vec<String> =
        sqlx::query_as::<_, (String,)>(r#"SELECT id FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#)
            .bind(&prefix)
            .fetch_all(pool)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|(id,)| id)
            .collect();

    if ids.is_empty() {
        return TrackDeletionResult {
            count: 0,
            favorites_dropped: 0,
            playlists_dropped: 0,
        };
    }

    let (favorites_dropped, playlists_dropped) = count_dropped_links(pool, &ids).await;

    let result = sqlx::query(r#"DELETE FROM "LocalReleaseTrack" WHERE id = ANY($1::text[])"#)
        .bind(&ids)
        .execute(pool)
        .await;

    TrackDeletionResult {
        count: result.map(|r| r.rows_affected()).unwrap_or(0),
        favorites_dropped,
        playlists_dropped,
    }
}
