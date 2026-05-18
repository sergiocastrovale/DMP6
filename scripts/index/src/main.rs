mod db;
mod deletion;
mod images;
mod metadata;
mod nuke;

use chrono::{NaiveDateTime, Utc};
use clap::Parser;
use common::{
    artists::{is_special_artist_name, split_artists},
    checkpoint::{clear_index_checkpoint, load_index_checkpoint, save_index_checkpoint},
    config::{apply_db_overrides, load_config},
    db::{create_pool, ensure_artist_cached},
    filters::matches_filter,
    lock::{acquire_lock, clear_stale_lock_minutes, release_lock},
    progress::Reporter,
    s3::{create_s3_client, upload_to_s3},
    statistics::update_statistics,
    totals::{update_artist_totals_for_artist, update_release_totals_for_artist},
};
use futures::stream::{FuturesUnordered, StreamExt};
use jwalk::WalkDir;
use rayon::prelude::*;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use db::*;
use deletion::{delete_removed_tracks, detect_deleted_folders, folder_changed};
use images::{extract_cover_art, upload_release_image_to_s3, use_folder_image};
use metadata::extract_metadata;
use nuke::nuke_local_artists;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "opus", "aac", "ogg", "flac"];

#[derive(Parser, Debug)]
#[command(name = "index", about = "Index local music files into the database")]
struct IndexArgs {
    #[arg(long, short, help = "Start letter filter (a-z)")]
    from: Option<String>,

    #[arg(long, short, help = "End letter filter (a-z)")]
    to: Option<String>,

    #[arg(long, short, help = "Only process these artist folders (semicolon-separated)")]
    only: Option<String>,

    #[arg(long, help = "Only index these exact folder paths relative to MUSIC_DIR (semicolon-separated)")]
    folders: Option<String>,

    #[arg(long, help = "Re-index a single release by its LocalRelease ID")]
    release: Option<String>,

    #[arg(long, help = "Re-index all tracks, ignoring change detection")]
    overwrite: bool,

    #[arg(long, help = "Skip cover art extraction")]
    skip_covers: bool,

    #[arg(long, help = "Skip folders whose directory mtime hasn't changed")]
    quick: bool,

    #[arg(long, help = "Resume from last saved checkpoint")]
    resume: bool,

    #[arg(long, help = "Delete all local data for matched artists, then exit")]
    delete: bool,

    #[arg(long, default_value = "8", help = "Rayon thread count for parallel extraction")]
    threads: usize,

    #[arg(long, help = "Override MUSIC_DIR from env")]
    music_dir: Option<String>,

    #[arg(long, help = "Emit PROGRESS:{json} lines for the web terminal (default: pretty console)")]
    web: bool,
}

fn has_filter(args: &IndexArgs) -> bool {
    args.from.is_some() || args.to.is_some() || args.only.is_some() || args.folders.is_some() || args.release.is_some()
}

#[tokio::main]
async fn main() {
    let args = IndexArgs::parse();
    let reporter = Reporter::new(args.web);
    let mut config = load_config(args.music_dir.as_deref());
    let pool = create_pool(&config.database_url).await;
    apply_db_overrides(&mut config, &pool).await;
    let music_dir = config.require_music_dir().to_string();

    if args.release.is_some()
        && (args.from.is_some() || args.to.is_some() || args.only.is_some() || args.folders.is_some())
    {
        eprintln!("Error: --release cannot be combined with --from, --to, --only, or --folders");
        std::process::exit(1);
    }

    let resolved_folders_from_release: Option<String> = if let Some(ref release_id) = args.release {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            r#"SELECT "folderPath" FROM "LocalRelease" WHERE id = $1"#,
        )
        .bind(release_id)
        .fetch_optional(&pool)
        .await
        .unwrap_or(None);

        match row {
            Some((Some(folder_path),)) if !folder_path.is_empty() => {
                Some(folder_path)
            }
            _ => {
                eprintln!("Error: release '{}' not found or has no folderPath", release_id);
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    // Clear stale locks (held > 10 min = leftover from crash/kill)
    if clear_stale_lock_minutes(&pool, 10).await {
        reporter.warn("Cleared a stale lock.");
    }

    let args_str = format!(
        "from={} to={} only={} overwrite={} quick={} delete={} release={}",
        args.from.as_deref().unwrap_or(""),
        args.to.as_deref().unwrap_or(""),
        args.only.as_deref().unwrap_or(""),
        args.overwrite,
        args.quick,
        args.delete,
        args.release.as_deref().unwrap_or(""),
    );
    if let Err(e) = acquire_lock(&pool, "index", std::process::id(), &args_str).await {
        reporter.err(&format!("Cannot start: {}", e));
        std::process::exit(1);
    }

    // SIGTERM / Ctrl-C handler — release lock before exiting
    let shutdown = Arc::new(AtomicBool::new(false));
    {
        let shutdown = shutdown.clone();
        let pool = pool.clone();
        tokio::spawn(async move {
            tokio::signal::ctrl_c().await.ok();
            shutdown.store(true, Ordering::SeqCst);
            eprintln!("\nShutdown requested — finishing current folder...");
            // Wait for second Ctrl-C → force exit after releasing lock
            tokio::signal::ctrl_c().await.ok();
            release_lock(&pool).await;
            std::process::exit(1);
        });
    }
    {
        let shutdown = shutdown.clone();
        let pool = pool.clone();
        tokio::spawn(async move {
            let mut term = tokio::signal::unix::signal(
                tokio::signal::unix::SignalKind::terminate(),
            )
            .expect("SIGTERM handler");
            term.recv().await;
            shutdown.store(true, Ordering::SeqCst);
            release_lock(&pool).await;
            std::process::exit(0);
        });
    }

    let project_root = config.project_root.clone();
    let use_local = config.use_local();
    let use_s3 = config.use_s3();
    let release_img_dir = PathBuf::from(&config.image_dir).join("releases");
    let artist_img_dir = PathBuf::from(&config.image_dir).join("artists");

    let s3_client = create_s3_client(&config).await;

    // -------------------------------------------------------------------------
    // Nuke mode
    // -------------------------------------------------------------------------
    if args.delete {
        let from = args.from.as_deref().unwrap_or("");
        let to = args.to.as_deref().unwrap_or("");
        let only = args.only.as_deref().unwrap_or("");
        reporter.info("Deleting local data for matched artists...");
        match nuke_local_artists(&pool, from, to, only, &project_root, &s3_client, &config).await {
            Ok(n) => reporter.info(&format!("Deleted {} artist(s).", n)),
            Err(e) => reporter.err(&format!("Delete error: {}", e)),
        }
        release_lock(&pool).await;
        return;
    }

    // -------------------------------------------------------------------------
    // Pre-load caches
    // -------------------------------------------------------------------------
    let mut artist_cache: HashMap<String, String> = {
        let rows: Vec<(String, String)> = sqlx::query_as(r#"SELECT slug, id FROM "Artist""#)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
        rows.into_iter().collect()
    };

    let mut release_cache: HashMap<String, String> = {
        let rows: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT "groupKey", id FROM "LocalRelease""#,
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        rows.into_iter().collect()
    };

    let folder_scans: HashMap<String, NaiveDateTime> = if args.quick {
        load_folder_scans(&pool).await
    } else {
        HashMap::new()
    };

    // -------------------------------------------------------------------------
    // Configure rayon thread pool
    // -------------------------------------------------------------------------
    rayon::ThreadPoolBuilder::new()
        .num_threads(if args.threads > 0 { args.threads } else { 8 })
        .build_global()
        .ok();

    // -------------------------------------------------------------------------
    // Discover top-level artist folders in MUSIC_DIR
    // -------------------------------------------------------------------------
    let from = args.from.as_deref().unwrap_or("");
    let to = args.to.as_deref().unwrap_or("");
    let only = args.only.as_deref().unwrap_or("");

    let target_folders: Option<HashMap<String, Vec<String>>> = resolved_folders_from_release
        .as_ref()
        .or(args.folders.as_ref())
        .map(|f| {
            let mut map: HashMap<String, Vec<String>> = HashMap::new();
            for folder in f.split(';').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                if let Some(artist) = folder.split('/').next() {
                    map.entry(artist.to_string()).or_default().push(folder.to_string());
                }
            }
            map
        });

    let mut artist_folders: Vec<String> = if let Some(ref tf) = target_folders {
        tf.keys().cloned().collect()
    } else {
        std::fs::read_dir(&music_dir)
            .expect("Cannot read MUSIC_DIR")
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|name| !name.starts_with('.'))
            .filter(|name| matches_filter(name, from, to, only))
            .collect()
    };

    artist_folders.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    // Resume: skip folders before the checkpoint
    if args.resume {
        if let Some(checkpoint) = load_index_checkpoint(&pool).await {
            let pos = artist_folders
                .iter()
                .position(|f| f.to_lowercase() > checkpoint.to_lowercase());
            if let Some(idx) = pos {
                reporter.info(&format!("Resuming from '{}'...", &checkpoint));
                artist_folders = artist_folders.split_off(idx);
            }
        }
    }

    let total_folders = artist_folders.len();

    reporter.header("DMP Index");
    reporter.kv("Music dir", &music_dir);
    reporter.kv("Threads", &if args.threads > 0 { args.threads.to_string() } else { "8".into() });
    if args.overwrite {
        reporter.kv("Mode", "overwrite");
    } else if args.quick {
        reporter.kv("Mode", "quick (skip unchanged folders)");
    }
    if args.skip_covers {
        reporter.kv("Covers", "skipped");
    }
    if let Some(ref release_id) = args.release {
        reporter.kv("Release", release_id);
        if let Some(ref fp) = resolved_folders_from_release {
            reporter.kv("Folder", fp);
        }
    } else if let Some(ref folders) = args.folders {
        reporter.kv("Folders", folders);
    } else if let Some(ref only) = args.only {
        reporter.kv("Filter", &format!("only '{}'", only));
    } else if args.from.is_some() || args.to.is_some() {
        reporter.kv(
            "Filter",
            &format!(
                "{} to {}",
                args.from.as_deref().unwrap_or(""),
                args.to.as_deref().unwrap_or("")
            ),
        );
    }
    reporter.kv(
        "Folders",
        &format!(
            "{}{}",
            total_folders,
            if total_folders == 1 { " folder" } else { " folders" }
        ),
    );
    reporter.blank();

    let start_time = std::time::Instant::now();

    // Record scan start
    sqlx::query(
        r#"UPDATE "Statistics" SET "lastScanStartedAt" = NOW(), "updatedAt" = NOW() WHERE id = 'main'"#,
    )
    .execute(&pool)
    .await
    .ok();

    // -------------------------------------------------------------------------
    // Global counters
    // -------------------------------------------------------------------------
    let mut total_files: u64 = 0;
    let mut new_total: u64 = 0;
    let mut updated_total: u64 = 0;
    let mut skipped_total: u64 = 0;
    let mut error_total: u64 = 0;
    let scanned_folders: HashSet<String> = artist_folders.iter().cloned().collect();

    // -------------------------------------------------------------------------
    // Main folder loop
    // -------------------------------------------------------------------------
    for (folder_idx, folder_name) in artist_folders.iter().enumerate() {
        if shutdown.load(Ordering::SeqCst) {
            break;
        }

        let folder_path = PathBuf::from(&music_dir).join(folder_name);

        // Quick mode: skip folder if its mtime hasn't changed
        if args.quick && !folder_changed(&folder_path, &folder_scans, folder_name) {
            continue;
        }

        reporter.item("", folder_name, folder_idx + 1, total_folders);

        // -----------------------------------------------------------------
        // Walk all audio files in this folder recursively
        // -----------------------------------------------------------------
        let walk_roots: Vec<PathBuf> = if let Some(ref tf) = target_folders {
            tf.get(folder_name)
                .map(|subs| subs.iter().map(|s| PathBuf::from(&music_dir).join(s)).collect())
                .unwrap_or_default()
        } else {
            vec![folder_path.clone()]
        };

        let paths: Vec<PathBuf> = walk_roots.iter()
            .flat_map(|root| {
                WalkDir::new(root)
                    .follow_links(true)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        if e.file_type().is_dir() {
                            return false;
                        }
                        e.path()
                            .extension()
                            .map_or(false, |ext| {
                                let el = ext.to_string_lossy().to_lowercase();
                                AUDIO_EXTENSIONS.contains(&el.as_str())
                            })
                    })
                    .map(|e| e.path().to_path_buf())
            })
            .collect();

        let file_count = paths.len();
        if file_count == 0 {
            reporter.sub_step("0 files");
            save_index_checkpoint(&pool, folder_name).await.ok();
            continue;
        }
        reporter.step(&format!("Extracting metadata ({} files)...", file_count));
        total_files += file_count as u64;

        // -----------------------------------------------------------------
        // Load existing tracks for change detection
        // -----------------------------------------------------------------
        let folder_prefix = format!("{}/", folder_name);
        let existing_tracks: HashMap<String, (i64, NaiveDateTime, String)> = if !args.overwrite && args.folders.is_none() {
            let rows: Vec<(String, i64, Option<NaiveDateTime>, Option<String>)> = sqlx::query_as(
                r#"SELECT "filePath", "fileSize", mtime, "contentHash"
                   FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
            )
            .bind(format!("{}%", folder_prefix))
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
            rows.into_iter()
                .map(|(path, size, mtime, hash)| {
                    (
                        path,
                        (
                            size,
                            mtime.unwrap_or_else(|| Utc::now().naive_utc()),
                            hash.unwrap_or_default(),
                        ),
                    )
                })
                .collect()
        } else {
            HashMap::new()
        };

        // -----------------------------------------------------------------
        // Parallel metadata extraction
        // -----------------------------------------------------------------
        let music_dir_clone = music_dir.clone();

        let par_results: Vec<Result<_, String>> = paths
            .par_iter()
            .map(|p| match extract_metadata(p, &music_dir_clone) {
                Ok(meta) => {
                    if meta.artist.is_none() || meta.artist.as_deref() == Some("") {
                        Err(format!("no artist tag: {}", p.display()))
                    } else {
                        Ok(meta)
                    }
                }
                Err(e) => Err(format!("{}: {}", p.display(), e)),
            })
            .collect();

        let mut extracted = Vec::with_capacity(par_results.len());
        let mut parse_errors: Vec<String> = Vec::new();
        for result in par_results {
            match result {
                Ok(meta) => extracted.push(meta),
                Err(msg) => parse_errors.push(msg),
            }
        }
        let folder_errors = parse_errors.len() as u64;
        error_total += folder_errors;
        for msg in &parse_errors {
            reporter.warn(msg);
        }

        if extracted.is_empty() {
            reporter.sub_step(&format!("{} files, all failed to parse", file_count));
            save_index_checkpoint(&pool, folder_name).await.ok();
            continue;
        }

        // -----------------------------------------------------------------
        // Pre-scan: propagate MB IDs within the same logical album
        // -----------------------------------------------------------------
        let mb_release_id_by_meta: HashMap<(String, i32, String), String> = {
            let mut map: HashMap<(String, i32, String), String> = HashMap::new();
            for track in &extracted {
                if let Some(ref id) = track.mb_release_id {
                    let key = (
                        track.album.as_deref().unwrap_or("").to_lowercase(),
                        track.year.unwrap_or(0),
                        track.album_artist.as_deref().unwrap_or("").to_lowercase(),
                    );
                    map.entry(key).or_insert_with(|| id.clone());
                }
            }
            map
        };
        let mb_release_group_id_by_meta: HashMap<(String, i32, String), String> = {
            let mut map: HashMap<(String, i32, String), String> = HashMap::new();
            for track in &extracted {
                if let Some(ref id) = track.mb_release_group_id {
                    let key = (
                        track.album.as_deref().unwrap_or("").to_lowercase(),
                        track.year.unwrap_or(0),
                        track.album_artist.as_deref().unwrap_or("").to_lowercase(),
                    );
                    map.entry(key).or_insert_with(|| id.clone());
                }
            }
            map
        };

        // -----------------------------------------------------------------
        // Change detection + build batch
        // -----------------------------------------------------------------
        let mut folder_new: u64 = 0;
        let mut folder_updated: u64 = 0;
        let mut folder_skipped: u64 = 0;
        let mut mtime_updates: Vec<(NaiveDateTime, String)> = Vec::new();
        let mut batch_tracks: Vec<_> = Vec::new();
        let mut pending_related_links: Vec<(String, String)> = Vec::new();
        let mut pending_release_artist_links: HashSet<(String, String)> = HashSet::new();
        let mut folder_artist_ids: HashSet<String> = HashSet::new();
        let mut releases_needing_art: HashMap<String, PathBuf> = HashMap::new();
        let mut folder_releases: HashMap<String, String> = HashMap::new();
        let mut releases_with_art: HashSet<String> = HashSet::new();

        for track in &extracted {
            // Change detection
            if !args.overwrite {
                if let Some((existing_size, existing_mtime, existing_hash)) =
                    existing_tracks.get(&track.file_path)
                {
                    if *existing_size == track.file_size
                        && (*existing_mtime - track.mtime).num_seconds().abs() < 2
                    {
                        skipped_total += 1;
                        folder_skipped += 1;
                        continue;
                    }
                    if *existing_hash == track.content_hash {
                        mtime_updates.push((track.mtime, track.file_path.clone()));
                        skipped_total += 1;
                        folder_skipped += 1;
                        continue;
                    }
                    updated_total += 1;
                    folder_updated += 1;
                } else {
                    new_total += 1;
                    folder_new += 1;
                }
            } else {
                new_total += 1;
                folder_new += 1;
            }

            let album_artist_tag = track.album_artist.as_deref().unwrap_or("");
            let track_artist_tag = track.artist.as_deref().unwrap_or("");

            let (main_album_artists, _feat_album_artists) =
                if !album_artist_tag.is_empty() && !is_special_artist_name(album_artist_tag) {
                    split_artists(album_artist_tag)
                } else {
                    (Vec::new(), Vec::new())
                };

            let (main_track_artists, feat_track_artists) = if !track_artist_tag.is_empty() {
                split_artists(track_artist_tag)
            } else {
                (Vec::new(), Vec::new())
            };

            let album_name = track.album.as_deref().unwrap_or("Unknown Album");

            let raw_folder_path = {
                let parts: Vec<&str> = track.file_path.rsplitn(2, '/').collect();
                if parts.len() > 1 {
                    parts[1].to_string()
                } else {
                    String::new()
                }
            };
            let folder_path_str = strip_disc_subfolder(&raw_folder_path);

            let meta_key = (
                track.album.as_deref().unwrap_or("").to_lowercase(),
                track.year.unwrap_or(0),
                track.album_artist.as_deref().unwrap_or("").to_lowercase(),
            );
            let effective_release_id = track.mb_release_id.as_deref().or_else(|| {
                mb_release_id_by_meta.get(&meta_key).map(|s| s.as_str())
            });
            let effective_rg_id = track.mb_release_group_id.as_deref().or_else(|| {
                mb_release_group_id_by_meta.get(&meta_key).map(|s| s.as_str())
            });

            let group_key = build_group_key(
                effective_release_id,
                effective_rg_id,
                album_name,
                track.year,
                track.album_artist.as_deref().unwrap_or(""),
                &folder_path_str,
            );

            let release_id = match ensure_local_release_cached(
                &pool,
                album_name,
                track.year,
                &folder_path_str,
                &group_key,
                &mut release_cache,
            )
            .await
            {
                Ok(id) => id,
                Err(e) => {
                    reporter.err(&format!("DB error (release '{}'): {}", album_name, e));
                    error_total += 1;
                    continue;
                }
            };

            let fp = track.file_path.clone();
            folder_releases
                .entry(release_id.clone())
                .or_insert_with(|| folder_path_str.clone());

            // Album-artist → release links (main artists)
            let album_artist_names_lower: HashSet<String> = main_album_artists
                .iter()
                .map(|n| n.to_lowercase())
                .collect();

            if main_album_artists.is_empty() {
                let fallback = main_track_artists
                    .first()
                    .map(|s| s.as_str())
                    .unwrap_or("Unknown Artist");
                if let Ok(aid) = ensure_artist_cached(&pool, fallback, &mut artist_cache, false).await {
                    if !aid.is_empty() {
                        pending_release_artist_links.insert((release_id.clone(), aid.clone()));
                        folder_artist_ids.insert(aid.clone());
                    }
                }
            } else {
                for aa_name in &main_album_artists {
                    if let Ok(aa_id) =
                        ensure_artist_cached(&pool, aa_name, &mut artist_cache, false).await
                    {
                        if !aa_id.is_empty() {
                            pending_release_artist_links
                                .insert((release_id.clone(), aa_id.clone()));
                            folder_artist_ids.insert(aa_id.clone());
                        }
                    }
                }
            }

            // Track-level related artists (artist tag names NOT in albumArtist)
            let all_track_names: Vec<String> = main_track_artists
                .into_iter()
                .chain(feat_track_artists.into_iter())
                .collect();
            for ta_name in &all_track_names {
                if album_artist_names_lower.contains(&ta_name.to_lowercase()) {
                    continue;
                }
                if let Ok(ta_id) =
                    ensure_artist_cached(&pool, ta_name, &mut artist_cache, true).await
                {
                    if !ta_id.is_empty() {
                        pending_related_links.push((fp.clone(), ta_id));
                    }
                }
            }

            // Queue cover art extraction
            if track.has_picture && !args.skip_covers {
                let out_path = release_img_dir.join(format!("{}.jpg", release_id));
                if !out_path.exists() {
                    releases_needing_art
                        .entry(release_id.clone())
                        .or_insert_with(|| PathBuf::from(format!("{}/{}", music_dir, &track.file_path)));
                }
            }

            batch_tracks.push((track, release_id));
        }

        // -----------------------------------------------------------------
        // Flush mtime-only updates
        // -----------------------------------------------------------------
        batch_update_mtimes(&pool, &mtime_updates).await.ok();

        // -----------------------------------------------------------------
        // Batch upsert tracks + resolve artist links
        // -----------------------------------------------------------------
        if !batch_tracks.is_empty() {
            match batch_upsert_tracks(&pool, &batch_tracks).await {
                Ok(path_to_id) => {
                    let resolved: Vec<(String, String)> = pending_related_links
                        .into_iter()
                        .filter_map(|(fp, aid)| {
                            path_to_id.get(&fp).map(|tid| (tid.clone(), aid))
                        })
                        .collect();
                    batch_ensure_track_related_artists(&pool, &resolved).await.ok();
                }
                Err(e) => {
                    reporter.err(&format!("Batch upsert error for '{}': {}", folder_name, e));
                    error_total += batch_tracks.len() as u64;
                }
            }
        }

        // Batch release-artist links
        if !pending_release_artist_links.is_empty() {
            let links: Vec<(String, String)> =
                pending_release_artist_links.into_iter().collect();
            batch_ensure_local_release_artists(&pool, &links).await.ok();
        }

        // -----------------------------------------------------------------
        // Backfill: ensure folder_releases + folder_artist_ids include
        // tracks that were skipped (unchanged) this run
        // -----------------------------------------------------------------
        {
            let db_releases: Vec<(String, String)> = sqlx::query_as(
                r#"SELECT DISTINCT lr.id, lr."folderPath"
                   FROM "LocalRelease" lr
                   WHERE lr."folderPath" LIKE $1"#,
            )
            .bind(format!("{}%", folder_name))
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
            for (rid, fp) in db_releases {
                folder_releases.entry(rid).or_insert(fp);
            }

            let folder_release_ids: Vec<String> = folder_releases.keys().cloned().collect();
            if !folder_release_ids.is_empty() {
                let album_artists: Vec<(String,)> = sqlx::query_as(
                    r#"SELECT DISTINCT lra."artistId"
                       FROM "LocalReleaseArtist" lra
                       WHERE lra."localReleaseId" = ANY($1::text[])"#,
                )
                .bind(&folder_release_ids)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();
                for (aid,) in album_artists {
                    folder_artist_ids.insert(aid);
                }
            }
        }

        // Print folder summary — verbose only when something actually changed
        {
            if folder_new > 0 || folder_updated > 0 {
                let mut parts = vec![format!("{} files", file_count)];
                if folder_new > 0 { parts.push(format!("{} new", folder_new)); }
                if folder_updated > 0 { parts.push(format!("{} updated", folder_updated)); }
                if folder_skipped > 0 { parts.push(format!("{} skipped", folder_skipped)); }
                if folder_errors > 0 { parts.push(format!("{} errors", folder_errors)); }
                reporter.ok(&parts.join(", "));
            } else if folder_errors > 0 {
                reporter.warn(&format!("{} errors", folder_errors));
            }
            // else: nothing changed — step header is sufficient
        }

        // -----------------------------------------------------------------
        // Cover art: embedded
        // -----------------------------------------------------------------
        if !args.skip_covers && !releases_needing_art.is_empty() {
            reporter.step(&format!(
                "Extracting artwork ({} releases)...",
                releases_needing_art.len()
            ));
            let art_entries: Vec<_> = releases_needing_art.iter().collect();
            let extracted_covers: Vec<(String, PathBuf, bool)> = art_entries
                .par_iter()
                .map(|(release_id, source_path)| {
                    let out_path = release_img_dir.join(format!("{}.jpg", release_id));
                    if out_path.exists() {
                        return ((*release_id).clone(), out_path, false);
                    }
                    let success = extract_cover_art(source_path, &out_path);
                    ((*release_id).clone(), out_path, success)
                })
                .collect();

            if use_s3 {
                if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                    (&s3_client, &config.s3_bucket, &config.s3_public_url)
                {
                    let mut uploads = FuturesUnordered::new();
                    for (release_id, out_path, newly_extracted) in &extracted_covers {
                        if !newly_extracted {
                            continue;
                        }
                        let client = client.clone();
                        let bucket = bucket.clone();
                        let public_url = public_url.clone();
                        let pool2 = pool.clone();
                        let rid = release_id.clone();
                        let p = out_path.clone();
                        uploads.push(async move {
                            upload_release_image_to_s3(&client, &bucket, &public_url, &pool2, &rid, &p).await;
                            rid
                        });
                        if uploads.len() >= 8 {
                            if let Some(rid) = uploads.next().await {
                                releases_with_art.insert(rid);
                            }
                        }
                    }
                    while let Some(rid) = uploads.next().await {
                        releases_with_art.insert(rid);
                    }
                }
            }

            for (release_id, _out_path, newly_extracted) in &extracted_covers {
                if !newly_extracted {
                    continue;
                }
                if use_local {
                    let filename = format!("{}.jpg", release_id);
                    sqlx::query(
                        r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                    )
                    .bind(&filename)
                    .bind(release_id)
                    .execute(&pool)
                    .await
                    .ok();
                }
                releases_with_art.insert(release_id.clone());
            }
        }

        // Cover art: folder image fallback (cover.jpg / folder.jpg)
        if !args.skip_covers {
            let releases_without_art: Vec<(String, String)> = folder_releases
                .iter()
                .filter(|(rid, _)| !releases_with_art.contains(*rid))
                .map(|(rid, fp)| (rid.clone(), fp.clone()))
                .collect();

            for (release_id, rel_folder_path) in &releases_without_art {
                let abs_folder = PathBuf::from(&music_dir).join(rel_folder_path);
                let out_path = release_img_dir.join(format!("{}.jpg", release_id));

                if use_folder_image(&abs_folder, &out_path).is_some() {
                    if use_s3 {
                        if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                            (&s3_client, &config.s3_bucket, &config.s3_public_url)
                        {
                            let s3_key = format!("releases/{}.jpg", release_id);
                            if upload_to_s3(client, bucket, &s3_key, &out_path).await.is_ok() {
                                let image_url = format!(
                                    "{}/{}",
                                    public_url.trim_end_matches('/'),
                                    s3_key
                                );
                                sqlx::query(
                                    r#"UPDATE "LocalRelease" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                )
                                .bind(&image_url)
                                .bind(release_id)
                                .execute(&pool)
                                .await
                                .ok();
                            }
                        }
                    }
                    if use_local {
                        let filename = format!("{}.jpg", release_id);
                        sqlx::query(
                            r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                        )
                        .bind(&filename)
                        .bind(release_id)
                        .execute(&pool)
                        .await
                        .ok();
                    }
                    releases_with_art.insert(release_id.clone());
                }
            }

            // Artist folder image (single-artist folders only)
            if folder_artist_ids.len() == 1 {
                let artist_id = folder_artist_ids.iter().next().unwrap();
                let existing_img: Option<(Option<String>, Option<String>)> = sqlx::query_as(
                    r#"SELECT image, "imageUrl" FROM "Artist" WHERE id = $1"#,
                )
                .bind(artist_id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();

                let needs_image = existing_img
                    .map(|(img, url)| img.is_none() && url.is_none())
                    .unwrap_or(true);

                if needs_image {
                    let slug: Option<String> = sqlx::query_as::<_, (String,)>(
                        r#"SELECT slug FROM "Artist" WHERE id = $1"#,
                    )
                    .bind(artist_id)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten()
                    .map(|(s,)| s);

                    if let Some(ref artist_slug) = slug {
                        let out_path = artist_img_dir.join(format!("{}.jpg", artist_slug));
                        if images::use_artist_folder_image(&folder_path, &out_path) {
                            if use_s3 {
                                if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                                    (&s3_client, &config.s3_bucket, &config.s3_public_url)
                                {
                                    let s3_key = format!("artists/{}.jpg", artist_slug);
                                    if upload_to_s3(client, bucket, &s3_key, &out_path).await.is_ok() {
                                        let image_url = format!(
                                            "{}/{}",
                                            public_url.trim_end_matches('/'),
                                            s3_key
                                        );
                                        sqlx::query(
                                            r#"UPDATE "Artist" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                        )
                                        .bind(&image_url)
                                        .bind(artist_id)
                                        .execute(&pool)
                                        .await
                                        .ok();
                                    }
                                }
                            }
                            if use_local {
                                let filename = format!("{}.jpg", artist_slug);
                                sqlx::query(
                                    r#"UPDATE "Artist" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                )
                                .bind(&filename)
                                .bind(artist_id)
                                .execute(&pool)
                                .await
                                .ok();
                            }
                        }
                    }
                }
            }
        }

        if !args.skip_covers && !releases_with_art.is_empty() {
            reporter.sub_ok(&format!("Extracted {} cover(s)", releases_with_art.len()));
        }

        // Clean up temp images in S3-only mode
        if !use_local && use_s3 {
            for rid in &releases_with_art {
                let tmp = release_img_dir.join(format!("{}.jpg", rid));
                std::fs::remove_file(&tmp).ok();
            }
        }

        // -----------------------------------------------------------------
        // Delete tracks that no longer exist on disk
        // -----------------------------------------------------------------
        let deleted_tracks = if let Some(ref tf) = target_folders {
            let mut total = 0u64;
            for sub in tf.get(folder_name.as_str()).unwrap_or(&vec![]) {
                let prefix = format!("{}/", sub);
                total += delete_removed_tracks(&pool, &prefix, &music_dir).await;
            }
            total
        } else {
            delete_removed_tracks(&pool, &folder_prefix, &music_dir).await
        };

        // -----------------------------------------------------------------
        // Update totals + lastIndexedAt
        // -----------------------------------------------------------------
        for aid in &folder_artist_ids {
            update_release_totals_for_artist(&pool, aid).await.ok();
            update_artist_totals_for_artist(&pool, aid).await.ok();
            propagate_mb_artist_id(&pool, aid).await.ok();
        }

        let artist_ids_vec: Vec<String> = folder_artist_ids.into_iter().collect();
        update_last_indexed_at(&pool, &artist_ids_vec).await.ok();

        // -----------------------------------------------------------------
        // Upsert FolderScan + save checkpoint
        // -----------------------------------------------------------------
        if let Ok(meta) = std::fs::metadata(&folder_path) {
            if let Ok(sys_mtime) = meta.modified() {
                if let Ok(dur) = sys_mtime.duration_since(std::time::UNIX_EPOCH) {
                    if let Some(dt) =
                        chrono::DateTime::from_timestamp(dur.as_secs() as i64, 0)
                            .map(|d| d.naive_utc())
                    {
                        upsert_folder_scan(&pool, folder_name, dt).await.ok();
                    }
                }
            }
        }
        save_index_checkpoint(&pool, folder_name).await.ok();
        update_statistics(&pool).await.ok();

        // Emit structured progress for terminal UI
        reporter.index_progress(
            folder_name,
            folder_idx + 1,
            total_folders,
            folder_new,
            folder_updated,
            folder_skipped,
            deleted_tracks,
        );
    }

    // -------------------------------------------------------------------------
    // Post-loop: detect entirely deleted folders
    // -------------------------------------------------------------------------
    if !shutdown.load(Ordering::SeqCst) && !has_filter(&args) {
        let del = detect_deleted_folders(&pool, &scanned_folders, &config).await;
        if del.tracks_deleted > 0 {
            reporter.info(&format!(
                "Removed {} track(s), {} release(s), {} artist(s) for deleted folders.",
                del.tracks_deleted, del.releases_deleted, del.artists_deleted
            ));
        }
    }

    // -------------------------------------------------------------------------
    // Post-loop: re-extract missing release covers (safety net)
    // -------------------------------------------------------------------------
    if !shutdown.load(Ordering::SeqCst) && !args.skip_covers {
        let missing: Vec<(String, String, Option<String>)> = sqlx::query_as(
            r#"SELECT DISTINCT ON (lr.id) lr.id, lrt."filePath", lr."folderPath"
               FROM "LocalRelease" lr
               JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
               WHERE (lr.image IS NULL OR lr.image = '')
                 AND (lr."imageUrl" IS NULL OR lr."imageUrl" = '')
               ORDER BY lr.id, lrt."trackNumber" NULLS LAST, lrt."filePath""#,
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        if !missing.is_empty() {
            reporter.step(&format!(
                "Re-checking {} release(s) with missing images...",
                missing.len()
            ));
            let mut fixed = 0u32;
            for (release_id, file_path, folder_path) in &missing {
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }
                let out_path = release_img_dir.join(format!("{}.jpg", release_id));

                let mut got_image = out_path.exists();
                if !got_image {
                    let full_path = PathBuf::from(&music_dir).join(file_path);
                    if extract_cover_art(&full_path, &out_path) {
                        got_image = true;
                    }
                }
                if !got_image {
                    if let Some(fp) = folder_path {
                        let abs_folder = PathBuf::from(&music_dir).join(fp);
                        if use_folder_image(&abs_folder, &out_path).is_some() {
                            got_image = true;
                        }
                    }
                }

                if got_image {
                    if use_s3 {
                        if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                            (&s3_client, &config.s3_bucket, &config.s3_public_url)
                        {
                            upload_release_image_to_s3(
                                client, bucket, public_url, &pool, release_id, &out_path,
                            )
                            .await;
                        }
                    }
                    if use_local {
                        let filename = format!("{}.jpg", release_id);
                        sqlx::query(
                            r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                        )
                        .bind(&filename)
                        .bind(release_id)
                        .execute(&pool)
                        .await
                        .ok();
                    }
                    if !use_local && use_s3 {
                        std::fs::remove_file(&out_path).ok();
                    }
                    fixed += 1;
                }
            }
            if fixed > 0 {
                reporter.ok(&format!("Restored {} missing cover(s)", fixed));
            }
        }
    }

    // -------------------------------------------------------------------------
    // Finalization
    // -------------------------------------------------------------------------
    let elapsed = start_time.elapsed();
    let h = elapsed.as_secs() / 3600;
    let m = (elapsed.as_secs() % 3600) / 60;
    let s = elapsed.as_secs() % 60;

    reporter.blank();
    reporter.info(&format!("{}", "═".repeat(60)));
    reporter.blank();
    reporter.done(&format!("Done. ({}h:{:02}m:{:02}s)", h, m, s));
    if new_total > 0 || updated_total > 0 {
        reporter.info(&format!(
            "  Files: {} | New: {} | Updated: {} | Skipped: {} | Errors: {}",
            total_files, new_total, updated_total, skipped_total, error_total
        ));
    } else {
        let mut parts = vec![format!("{} up to date", skipped_total)];
        if error_total > 0 { parts.push(format!("{} errors", error_total)); }
        reporter.info(&format!("  {}", parts.join(" | ")));
    }

    clear_index_checkpoint(&pool).await.ok();
    update_statistics(&pool).await.ok();
    release_lock(&pool).await;
}
