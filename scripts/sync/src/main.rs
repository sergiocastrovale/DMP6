use clap::Parser;
use common::config::{apply_db_overrides, load_config};
use common::db::create_pool;
use common::filters::{matches_filter, sanitize_mb_id};
use common::lock::{acquire_lock, clear_stale_lock_minutes, release_lock};
use common::progress::Reporter;
use common::s3::create_s3_client;
use common::run_hash::{clear_run_hash, get_run_hash, new_run_hash, set_run_hash};
use common::statistics::update_statistics;
use common::types::TrackMeta;
use reqwest::Client;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

mod catalogue_gaps;
mod db;
mod images;
mod mb_api;
mod mb_matching;
mod mb_types;
mod nuke;
mod status;

use db::*;
use images::{download_artist_image, download_cover_art};
use mb_api::RateLimiter;
use mb_matching::{find_mb_match_with_fallback, is_special_artist_name};
use mb_types::{MbArtistMatch, MbRelease, MbTrack};
use nuke::nuke_mb_data;
use status::{check_release_status, status_to_db_string};

#[derive(Parser, Debug)]
#[command(name = "sync")]
struct SyncArgs {
    #[arg(long, short)]
    from: Option<String>,
    #[arg(long, short)]
    to: Option<String>,
    #[arg(long, short, help = "Only sync these artists (semicolon-separated)")]
    only: Option<String>,
    #[arg(long, help = "Re-sync a single release by its LocalRelease ID")]
    release: Option<String>,
    #[arg(long)]
    overwrite: bool,
    #[arg(long, help = "Exact match for --only (no prefix matching)")]
    exact: bool,
    #[arg(long)]
    skip_artist_img: bool,
    #[arg(long)]
    skip_release_img: bool,
    #[arg(long, help = "Skip writing MusicBrainz IDs back to audio file tags")]
    skip_mb_tags: bool,
    #[arg(long, help = "Write DB-known MB IDs to file tags (no API calls), then exit")]
    only_write_mb_to_files: bool,
    #[arg(long)]
    delete: bool,
    #[arg(long, help = "Fast pass: populate MISSING catalogue entries only (1 API call/artist)")]
    catalogue_gaps: bool,
    #[arg(long, help = "Read artist IDs from file (one per line, used by refresh)")]
    artist_ids: Option<String>,
    #[arg(long)]
    verbose: bool,
    /// Emit PROGRESS:{json} lines and plain output for the web terminal.
    /// Default is pretty colored console output.
    #[arg(long)]
    web: bool,
}

fn get_majority_id(tracks: &[LocalTrackRow], field: fn(&LocalTrackRow) -> &Option<String>) -> Option<String> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for t in tracks {
        if let Some(ref id) = field(t) {
            if !id.is_empty() {
                *counts.entry(id.as_str()).or_insert(0) += 1;
            }
        }
    }
    counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .map(|(id, _)| id.to_string())
}

fn synthesize_edition_label(
    release: &mb_types::MbRelease,
    rg_first_release_date: Option<&str>,
) -> Option<String> {
    if release.disambiguation.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
        return None;
    }
    let release_year = release.date.as_deref().and_then(year_from_date)?;
    let rg_year = rg_first_release_date.and_then(year_from_date);
    match rg_year {
        Some(rg_y) if rg_y == release_year => Some("original release".to_string()),
        Some(_) => Some(format!("{} reissue", release_year)),
        None => None,
    }
}

fn year_from_date(date: &str) -> Option<i32> {
    date.split('-').next()?.parse::<i32>().ok()
}

fn format_from_media(media: &Option<Vec<mb_types::MbMedia>>) -> Option<String> {
    let media = media.as_ref()?;
    let mut formats: Vec<String> = media
        .iter()
        .filter_map(|m| m.format.as_deref())
        .map(|s| s.to_string())
        .collect();
    formats.sort();
    formats.dedup();
    if formats.is_empty() {
        None
    } else {
        Some(formats.join(", "))
    }
}

fn local_track_to_meta(t: &LocalTrackRow) -> TrackMeta {
    let now = chrono::Utc::now().naive_utc();
    TrackMeta {
        file_path: String::new(),
        file_size: 0,
        mtime: now,
        title: t.title.clone(),
        artist: t.artist.clone(),
        album_artist: None,
        album: None,
        year: None,
        genre: None,
        track_number: t.track_number,
        disc_number: t.disc_number,
        duration: None,
        bitrate: None,
        sample_rate: None,
        position: None,
        content_hash: String::new(),
        metadata_json: serde_json::Value::Null,
        has_picture: false,
        mb_release_id: t.mb_release_id.clone(),
        mb_release_group_id: t.mb_release_group_id.clone(),
        mb_album_artist_id: t.mb_album_artist_id.clone(),
    }
}

#[tokio::main]
async fn main() {
    let args = SyncArgs::parse();
    common::error_log::init("sync");
    let reporter = Reporter::new(args.web);
    let mut config = load_config(None);
    let pool = create_pool(&config.database_url).await;
    apply_db_overrides(&mut config, &pool).await;

    if args.release.is_some()
        && (args.from.is_some() || args.to.is_some() || args.only.is_some())
    {
        common::error_log::log_error("--release cannot be combined with --from, --to, or --only");
        eprintln!("Error: --release cannot be combined with --from, --to, or --only");
        std::process::exit(1);
    }

    if args.catalogue_gaps
        && (args.release.is_some() || args.delete)
    {
        common::error_log::log_error(
            "--catalogue-gaps cannot be combined with --release or --delete",
        );
        eprintln!("Error: --catalogue-gaps cannot be combined with --release or --delete");
        std::process::exit(1);
    }

    if args.only_write_mb_to_files
        && (args.release.is_some() || args.delete || args.catalogue_gaps)
    {
        common::error_log::log_error(
            "--only-write-mb-to-files cannot be combined with --release, --delete, or --catalogue-gaps",
        );
        eprintln!("Error: --only-write-mb-to-files cannot be combined with --release, --delete, or --catalogue-gaps");
        std::process::exit(1);
    }

    if clear_stale_lock_minutes(&pool, 10).await {
        reporter.warn("Cleared stale scan lock.");
    }

    let pid = std::process::id();
    let lock_args = serde_json::json!({
        "from": args.from,
        "to": args.to,
        "only": args.only,
        "release": args.release,
        "overwrite": args.overwrite,
    });

    if let Err(e) = acquire_lock(&pool, "sync", pid, &lock_args.to_string()).await {
        reporter.err(&format!("Cannot start: {}", e));
        std::process::exit(1);
    }

    // SIGTERM / Ctrl-C handler - release lock before exiting
    let running = Arc::new(AtomicBool::new(true));
    {
        let running = running.clone();
        let pool2 = pool.clone();
        tokio::spawn(async move {
            tokio::signal::ctrl_c().await.ok();
            running.store(false, Ordering::SeqCst);
            eprintln!("\nShutdown requested - finishing current artist...");
            tokio::signal::ctrl_c().await.ok();
            release_lock(&pool2).await;
            std::process::exit(1);
        });
    }
    {
        let running = running.clone();
        let pool2 = pool.clone();
        tokio::spawn(async move {
            let mut term = tokio::signal::unix::signal(
                tokio::signal::unix::SignalKind::terminate(),
            )
            .expect("SIGTERM handler");
            term.recv().await;
            running.store(false, Ordering::SeqCst);
            release_lock(&pool2).await;
            std::process::exit(0);
        });
    }

    let s3_client = create_s3_client(&config).await;

    let http_client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("HTTP client");

    let mut limiter = RateLimiter::new();
    limiter.set_web(args.web);

    if args.delete {
        match nuke_mb_data(
            &pool,
            args.from.as_deref(),
            args.to.as_deref(),
            args.only.as_deref(),
            args.exact,
            &config.project_root,
            &s3_client,
            &config,
        )
        .await
        {
            Ok(n) => reporter.info(&format!("Nuked MB data for {} artists.", n)),
            Err(e) => reporter.err(&format!("Nuke error: {}", e)),
        }
        release_lock(&pool).await;
        return;
    }

    if args.catalogue_gaps {
        reporter.header("DMP Sync - Catalogue Gaps");
        reporter.kv("Mode", "catalogue-gaps (MISSING entries only, 1 API call/artist)");
        if args.overwrite {
            reporter.kv("Overwrite", "yes");
        }
        if let Some(ref only) = args.only {
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
        reporter.blank();

        match catalogue_gaps::fill_catalogue_gaps(
            &pool,
            &http_client,
            &mut limiter,
            &reporter,
            &running,
            args.from.as_deref(),
            args.to.as_deref(),
            args.only.as_deref(),
            args.exact,
            args.overwrite,
            args.verbose,
        )
        .await
        {
            Ok((artists, gaps)) => {
                if let Ok(n) = db::retire_owned_missing_placeholders(&pool).await {
                    if n > 0 {
                        reporter.info(&format!("Retired {} owned MISSING placeholder(s)", n));
                    }
                }
                update_statistics(&pool).await.ok();
                reporter.blank();
                reporter.done(&format!(
                    "Catalogue gaps complete: {} artist(s) processed, {} gap(s) recorded",
                    artists, gaps
                ));
            }
            Err(e) => reporter.err(&format!("Catalogue gaps error: {}", e)),
        }
        release_lock(&pool).await;
        return;
    }

    if args.only_write_mb_to_files {
        let music_dir = config.music_dir.as_deref().unwrap_or("");
        if music_dir.is_empty() {
            reporter.err("No music_dir configured - cannot write to files");
            release_lock(&pool).await;
            std::process::exit(1);
        }

        reporter.header("DMP Sync - Write MB IDs to Files");

        let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            r#"SELECT id, name, slug, "musicbrainzId" FROM "Artist"
               WHERE "relatedOnly" = false AND "musicbrainzId" IS NOT NULL
               ORDER BY name"#,
        )
        .fetch_all(&pool)
        .await
        .expect("DB query failed");

        let artists: Vec<(String, String, Option<String>)> = rows
            .into_iter()
            .filter(|(_, name, _, _)| {
                matches_filter(
                    name,
                    args.from.as_deref().unwrap_or(""),
                    args.to.as_deref().unwrap_or(""),
                    args.only.as_deref().unwrap_or(""),
                    args.exact,
                )
            })
            .map(|(id, name, _, mb_id)| (id, name, mb_id))
            .collect();

        let total = artists.len();
        reporter.info(&format!("{} artist(s) with MB IDs", total));
        reporter.blank();

        let mut total_written = 0u32;
        let mut total_tracks = 0u32;

        for (i, (artist_id, artist_name, artist_mb_id)) in artists.iter().enumerate() {
            let mb_artist_id = match artist_mb_id {
                Some(id) => id,
                None => continue,
            };

            let tracks = match get_tracks_with_mb_ids_for_artist(&pool, artist_id).await {
                Ok(t) => t,
                Err(e) => {
                    reporter.err(&format!("{}: DB error: {}", artist_name, e));
                    continue;
                }
            };

            if tracks.is_empty() {
                continue;
            }

            let mut written = 0u32;
            for track in &tracks {
                let abs_path = std::path::Path::new(music_dir).join(&track.file_path);
                if !abs_path.exists() {
                    continue;
                }
                match common::tags::write_mb_ids(
                    &abs_path,
                    Some(mb_artist_id),
                    Some(&track.mb_release_id),
                    Some(&track.mb_release_group_id),
                    track.mb_track_id.as_deref(),
                ) {
                    Ok(true) => { written += 1; }
                    Ok(false) => {}
                    Err(e) => {
                        reporter.warn(&format!("{}: {}", track.file_path, e));
                    }
                }
            }

            if written > 0 {
                reporter.ok(&format!(
                    "[{}/{}] {} - wrote {}/{} tracks",
                    i + 1, total, artist_name, written, tracks.len()
                ));
                total_written += written;
            }
            total_tracks += tracks.len() as u32;
        }

        reporter.blank();
        reporter.done(&format!(
            "Wrote MB IDs to {} / {} tracks across {} artists",
            total_written, total_tracks, total
        ));
        release_lock(&pool).await;
        return;
    }

    let target_release_id: Option<String> = args.release.clone();

    let is_targeted = args.release.is_some();
    let run_hash: Option<String> = if is_targeted {
        None
    } else if args.overwrite {
        let h = new_run_hash();
        set_run_hash(&pool, "syncRunHash", &h).await;
        Some(h)
    } else {
        match get_run_hash(&pool, "syncRunHash").await {
            Some(h) => {
                reporter.info(&format!("Resuming run (hash: {})", &h[..8]));
                Some(h)
            }
            None => {
                let h = new_run_hash();
                set_run_hash(&pool, "syncRunHash", &h).await;
                Some(h)
            }
        }
    };

    let already_synced: HashSet<String> = if let Some(ref h) = run_hash {
        load_synced_artist_ids(&pool, h).await
    } else {
        HashSet::new()
    };
    if !already_synced.is_empty() {
        reporter.info(&format!("Skipping {} already-processed artist(s)", already_synced.len()));
    }

    reporter.header("DMP Sync");
    reporter.kv(
        "Mode",
        if args.release.is_some() {
            "single release"
        } else if args.artist_ids.is_some() {
            "artist IDs from file"
        } else if args.overwrite {
            "overwrite (re-sync all matched)"
        } else {
            "pending (lastIndexedAt > lastSyncedAt)"
        },
    );
    if let Some(ref release_id) = args.release {
        reporter.kv("Release", release_id);
    } else if let Some(ref path) = args.artist_ids {
        reporter.kv("Artist IDs file", path);
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
    reporter.blank();

    let mut artists: Vec<ArtistSyncRow> = if let Some(ref release_id) = target_release_id {
        match get_artist_for_release(&pool, release_id).await {
            Ok(Some(artist)) => {
                reporter.info(&format!("Release {} → artist: {}", release_id, artist.name));
                vec![artist]
            }
            Ok(None) => {
                reporter.err(&format!(
                    "Release '{}' not found or has no non-relatedOnly artist",
                    release_id
                ));
                release_lock(&pool).await;
                std::process::exit(1);
            }
            Err(e) => {
                reporter.err(&format!("DB error looking up release '{}': {}", release_id, e));
                release_lock(&pool).await;
                std::process::exit(1);
            }
        }
    } else if let Some(ref ids_path) = args.artist_ids {
        let content = std::fs::read_to_string(ids_path)
            .unwrap_or_else(|e| panic!("Failed to read artist IDs file '{}': {}", ids_path, e));
        let ids: Vec<String> = content.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect();
        if ids.is_empty() {
            vec![]
        } else {
            let rows: Vec<(String, String, String, Option<String>, Option<String>, Option<String>)> =
                sqlx::query_as(
                    r#"SELECT id, name, slug, "musicbrainzId", image, "imageUrl" FROM "Artist" WHERE id = ANY($1::text[])"#,
                )
                .bind(&ids)
                .fetch_all(&pool)
                .await
                .expect("DB query failed");
            rows.into_iter()
                .map(|(id, name, slug, mb_id, image, image_url)| ArtistSyncRow {
                    id,
                    name,
                    slug,
                    mb_id: mb_id.as_deref().and_then(sanitize_mb_id),
                    has_image: image.is_some() || image_url.is_some(),
                })
                .collect()
        }
    } else if args.overwrite {
        let rows: Vec<(String, String, String, Option<String>, Option<String>, Option<String>)> =
            sqlx::query_as(
                r#"SELECT id, name, slug, "musicbrainzId", image, "imageUrl" FROM "Artist" WHERE "relatedOnly" = false ORDER BY name"#,
            )
            .fetch_all(&pool)
            .await
            .expect("DB query failed");

        rows.into_iter()
            .filter(|(_, name, _, _, _, _)| {
                matches_filter(
                    name,
                    args.from.as_deref().unwrap_or(""),
                    args.to.as_deref().unwrap_or(""),
                    args.only.as_deref().unwrap_or(""),
                    args.exact,
                )
            })
            .map(|(id, name, slug, mb_id, image, image_url)| ArtistSyncRow {
                id,
                name,
                slug,
                mb_id: mb_id.as_deref().and_then(sanitize_mb_id),
                has_image: image.is_some() || image_url.is_some(),
            })
            .collect()
    } else {
        get_artists_pending_sync(&pool)
            .await
            .expect("DB query failed")
            .into_iter()
            .filter(|a| {
                matches_filter(
                    &a.name,
                    args.from.as_deref().unwrap_or(""),
                    args.to.as_deref().unwrap_or(""),
                    args.only.as_deref().unwrap_or(""),
                    args.exact,
                )
            })
            .collect()
    };

    // Expand with connected (linked) artists when filtering
    let has_filter = args.only.is_some() || args.from.is_some() || args.to.is_some() || args.artist_ids.is_some();
    if has_filter && !artists.is_empty() {
        let primary_ids: Vec<String> = artists.iter().map(|a| a.id.clone()).collect();
        let connected: Vec<(String, String, String, Option<String>, Option<String>, Option<String>)> =
            sqlx::query_as(
                r#"SELECT id, name, slug, "musicbrainzId", image, "imageUrl"
                   FROM "Artist"
                   WHERE "primaryArtistId" = ANY($1::text[])
                   ORDER BY name"#,
            )
            .bind(&primary_ids)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();

        let existing_ids: HashSet<String> = artists.iter().map(|a| a.id.clone()).collect();
        let mut added = 0usize;
        for (id, name, slug, mb_id, image, image_url) in connected {
            if !existing_ids.contains(&id) {
                artists.push(ArtistSyncRow {
                    id,
                    name,
                    slug,
                    mb_id: mb_id.as_deref().and_then(sanitize_mb_id),
                    has_image: image.is_some() || image_url.is_some(),
                });
                added += 1;
            }
        }
        if added > 0 {
            reporter.info(&format!("Including {} linked artist(s)", added));
        }
    }

    let total = artists.len();
    reporter.info(&format!("Syncing {} artist(s)...", total));
    reporter.blank();

    let mut release_type_cache: HashMap<String, String> = HashMap::new();
    let mut genre_cache: HashMap<String, String> = HashMap::new();

    let mut total_synced = 0usize;
    let mut total_partial = 0usize;
    let mut failed_artists: Vec<(String, String)> = Vec::new();
    let start_time = std::time::Instant::now();

    // MB ID → DB artist ID: detect duplicate artists resolving to the same MB ID.
    let mut synced_mb_ids: HashMap<String, String> = HashMap::new();
    let mut release_group_cache: HashMap<String, Vec<mb_types::MbReleaseGroup>> = HashMap::new();

    for (i, artist) in artists.iter().enumerate() {
        if !running.load(Ordering::SeqCst) {
            break;
        }

        if already_synced.contains(&artist.id) {
            continue;
        }

        // Skip special artists (Various Artists, [unknown], etc.)
        if is_special_artist_name(&artist.name) {
            reporter.item("", &artist.name, i + 1, total);
            reporter.skip("Special artist - skipped");
            if let Some(ref h) = run_hash {
                stamp_sync_hash(&pool, &artist.id, h).await;
            }
            continue;
        }

        reporter.sync_progress(&artist.name, i + 1, total, "syncing");
        reporter.item("", &artist.name, i + 1, total);

        let local_releases = match get_local_releases_for_artist(&pool, &artist.id).await {
            Ok(r) => r,
            Err(e) => {
                reporter.err(&format!("DB error: {}", e));
                continue;
            }
        };

        if local_releases.is_empty() {
            reporter.skip("No local releases - skipped");
            reporter.sync_progress(&artist.name, i + 1, total, "skipped");
            if let Some(ref h) = run_hash {
                stamp_sync_hash(&pool, &artist.id, h).await;
            }
            continue;
        }

        // 1. Find artist on MusicBrainz
        let has_mb_id = artist.mb_id.as_ref().map_or(false, |id| !id.is_empty());
        if has_mb_id && !args.overwrite {
            reporter.step("Looking up artist...");
        } else {
            reporter.step("Searching MusicBrainz...");
        }

        let mb_artist_opt: Option<MbArtistMatch> =
            if let Some(ref existing_id) = artist.mb_id {
                if !existing_id.is_empty() && !args.overwrite {
                    Some(MbArtistMatch {
                        id: existing_id.clone(),
                        name: artist.name.clone(),
                        score: Some(100),
                    })
                } else {
                    match find_mb_match_with_fallback(
                        &http_client,
                        &pool,
                        &artist.id,
                        &artist.name,
                        artist.mb_id.as_deref(),
                        &mut limiter,
                    )
                    .await
                    {
                        Ok(result) => result,
                        Err(e) => {
                            reporter.err(&format!("Search error: {}", e));
                            failed_artists.push((artist.name.clone(), format!("Search error: {}", e)));
                            None
                        }
                    }
                }
            } else {
                match find_mb_match_with_fallback(
                    &http_client,
                    &pool,
                    &artist.id,
                    &artist.name,
                    None,
                    &mut limiter,
                )
                .await
                {
                    Ok(result) => result,
                    Err(e) => {
                        reporter.err(&format!("Search error: {}", e));
                        failed_artists.push((artist.name.clone(), format!("Search error: {}", e)));
                        None
                    }
                }
            };

        let mb_artist = match mb_artist_opt {
            Some(m) => {
                reporter.sub_ok(&format!("Found: {} ({})", m.name, m.id));
                m
            }
            None => {
                reporter.skip("No MB match");
                reporter.sync_progress(&artist.name, i + 1, total, "no_match");
                let now = chrono::Utc::now().naive_utc();
                sqlx::query(
                    r#"UPDATE "Artist" SET "lastSyncedAt" = $1, "updatedAt" = $1 WHERE id = $2"#,
                )
                .bind(now)
                .bind(&artist.id)
                .execute(&pool)
                .await
                .ok();
                if let Some(ref h) = run_hash {
                    stamp_sync_hash(&pool, &artist.id, h).await;
                }
                continue;
            }
        };

        // Duplicate detection: another artist already resolved to this MB ID
        let mut is_duplicate = false;
        let mut primary_artist_id: Option<String> = None;

        if let Some(prev_id) = synced_mb_ids.get(&mb_artist.id) {
            if prev_id != &artist.id {
                is_duplicate = true;
                primary_artist_id = Some(prev_id.clone());
            }
        }

        if !is_duplicate {
            if let Some((db_primary_id,)) = sqlx::query_as::<_, (String,)>(
                r#"SELECT id FROM "Artist"
                   WHERE "musicbrainzId" = $1 AND id != $2 AND "relatedOnly" = false
                     AND "primaryArtistId" IS NULL
                   LIMIT 1"#,
            )
            .bind(&mb_artist.id)
            .bind(&artist.id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
            {
                is_duplicate = true;
                primary_artist_id = Some(db_primary_id);
            }
        }

        if !is_duplicate {
            synced_mb_ids.insert(mb_artist.id.clone(), artist.id.clone());
        }

        if is_duplicate {
            let primary_id = primary_artist_id.as_ref().unwrap();
            reporter.step("Connected to primary artist (syncing releases only)");
            sqlx::query(
                r#"UPDATE "Artist" SET "primaryArtistId" = $1, "updatedAt" = NOW()
                   WHERE id = $2 AND "primaryArtistId" IS NULL"#,
            )
            .bind(primary_id)
            .bind(&artist.id)
            .execute(&pool)
            .await
            .ok();
        }

        let (artist_genre_ids, country_code): (Vec<String>, Option<String>) = if is_duplicate {
            let genres = get_artist_genre_ids(&pool, primary_artist_id.as_ref().unwrap()).await;
            (genres, None)
        } else {
            // Persist MB ID if newly found or changed
            if artist.mb_id.as_deref() != Some(&mb_artist.id) {
                sqlx::query(
                    r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                )
                .bind(&mb_artist.id)
                .bind(&artist.id)
                .execute(&pool)
                .await
                .ok();
            }

            // 2. Artist detail (genres, tags, URLs)
            reporter.step("Fetching artist details...");
            let detail =
                match mb_api::mb_get_artist_detail(&http_client, &mb_artist.id, &mut limiter).await {
                    Ok(d) => d,
                    Err(e) => {
                        reporter.err(&format!("Detail error: {}", e));
                        continue;
                    }
                };

            let country_code = detail.country_code().map(|s| s.to_string());

            // Upsert genres from MB genres + tags
            let mut artist_genre_ids: Vec<String> = Vec::new();
            if let Some(ref genres) = detail.genres {
                let mut sorted = genres.to_vec();
                sorted.sort_by(|a, b| b.count.unwrap_or(0).cmp(&a.count.unwrap_or(0)));
                for genre in sorted.iter().take(5) {
                    if let Ok(id) = ensure_genre_cached(&pool, &genre.name, &mut genre_cache).await {
                        artist_genre_ids.push(id);
                    }
                }
            }
            if let Some(ref tags) = detail.tags {
                for t in tags {
                    if t.count.unwrap_or(0) > 0 {
                        if let Ok(id) = ensure_genre_cached(&pool, &t.name, &mut genre_cache).await {
                            artist_genre_ids.push(id);
                        }
                    }
                }
            }
            artist_genre_ids.sort();
            artist_genre_ids.dedup();
            batch_link_artist_genres(&pool, &artist.id, &artist_genre_ids)
                .await
                .ok();

            // Upsert URLs
            let urls: Vec<(String, String)> = detail
                .relations
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .filter_map(|r| {
                    r.url
                        .as_ref()
                        .map(|u| (r.relation_type.clone(), u.resource.clone()))
                })
                .collect();
            batch_upsert_artist_urls(&pool, &artist.id, &urls).await.ok();
            reporter.sub_ok(&format!(
                "Saved {} URLs, {} genres{}",
                urls.len(),
                artist_genre_ids.len(),
                country_code.as_deref().map(|c| format!(", country: {}", c)).unwrap_or_default()
            ));

            // 3. Artist image - skip if already present
            if !args.skip_artist_img && !artist.has_image {
                reporter.sub_step("Downloading artist image...");
                let img_result = download_artist_image(
                    &http_client,
                    &detail,
                    &artist.slug,
                    &config.project_root,
                    &s3_client,
                    &config,
                )
                .await;
                match img_result {
                    Ok(true) => {
                        reporter.sub_ok("Artist image downloaded");
                        if config.use_local() {
                            let filename = format!("{}.jpg", &artist.slug);
                            sqlx::query(
                                r#"UPDATE "Artist" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                            )
                            .bind(&filename)
                            .bind(&artist.id)
                            .execute(&pool)
                            .await
                            .ok();
                        }
                        if config.use_s3() {
                            if let Some(ref public_url) = config.storage_public_url {
                                let image_url = format!(
                                    "{}/artists/{}.jpg",
                                    public_url.trim_end_matches('/'),
                                    &artist.slug
                                );
                                sqlx::query(
                                    r#"UPDATE "Artist" SET "imageUrl" = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                )
                                .bind(&image_url)
                                .bind(&artist.id)
                                .execute(&pool)
                                .await
                                .ok();
                            }
                        }
                    }
                    Ok(false) => {
                        reporter.sub_step("Artist image not found");
                    }
                    Err(e) => {
                        reporter.sub_step(&format!("Artist image error: {}", e));
                    }
                }
            }

            (artist_genre_ids, country_code)
        };

        // 4. Release groups (cached for duplicates sharing same MB artist)
        let release_groups = if is_duplicate {
            release_group_cache.get(&mb_artist.id).cloned().unwrap_or_default()
        } else {
            reporter.step("Fetching releases...");
            let rgs = match mb_api::mb_get_release_groups(&http_client, &mb_artist.id, &mut limiter).await {
                Ok(rgs) => rgs,
                Err(e) => {
                    reporter.err(&format!("Release groups error: {}", e));
                    vec![]
                }
            };
            release_group_cache.insert(mb_artist.id.clone(), rgs.clone());
            rgs
        };

        let mut score_sum = 0f64;
        let mut score_count = 0u32;
        let mut newly_synced_count = 0u32;
        let mut release_failures = 0u32;
        let mut releases_for_art: Vec<(String, String, String)> = Vec::new();

        let local_release_total = local_releases.len();
        for (lr_idx, local_release) in local_releases.iter().enumerate() {
            if let Some(ref target_id) = target_release_id {
                if local_release.id != *target_id {
                    continue;
                }
            }
            if local_release.forced_complete {
                continue;
            }
            let release_start = std::time::Instant::now();
            reporter.info(&format!(
                "    [{}/{}] {}",
                lr_idx + 1,
                local_release_total,
                local_release.title,
            ));

            // If already synced and not overwriting, skip the MB API call entirely.
            if !args.overwrite {
                if let Some(ref existing_mb_db_id) = local_release.release_id {
                    ensure_mb_release_artist_link(&pool, existing_mb_db_id, &artist.id)
                        .await
                        .ok();
                    batch_link_release_genres(&pool, existing_mb_db_id, &artist_genre_ids)
                        .await
                        .ok();
                    let score = match local_release.match_status.as_deref() {
                        Some("COMPLETE") => 1.0,
                        Some("EXTRA_TRACKS") => 0.85,
                        Some("MISSING_TRACKS") => 0.7,
                        Some("INCOMPLETE") => 0.5,
                        _ => 0.5,
                    };
                    score_sum += score;
                    score_count += 1;
                    if args.verbose {
                        reporter.skip(&format!("{} (already synced)", local_release.title));
                    }
                    continue;
                }
            }

            let local_tracks = match get_local_tracks_for_release(&pool, &local_release.id).await {
                Ok(t) => t,
                Err(_) => continue,
            };

            // 4-tier matching: collect majority MB IDs from local tracks
            let majority_release_id = get_majority_id(&local_tracks, |t| &t.mb_release_id);
            let majority_rg_id = get_majority_id(&local_tracks, |t| &t.mb_release_group_id);

            // Tier 1: Direct release lookup via embedded MUSICBRAINZ_ALBUMID
            let mut matched: Option<(String, String, Vec<(MbRelease, Vec<MbTrack>)>, String)> = None; // (release_id, rg_id, releases, type_name)
            if let Some(ref rel_id) = majority_release_id {
                let api_start = std::time::Instant::now();
                reporter.info(&format!("        → Lookup by album ID {}", rel_id));
                match mb_api::mb_get_release_by_id(&http_client, rel_id, &mut limiter).await {
                    Ok((release, tracks, rg_id)) => {
                        reporter.info(&format!(
                            "        ← Found release in {:.1}s ({} tracks)",
                            api_start.elapsed().as_secs_f64(),
                            tracks.len()
                        ));
                        let type_name = release_groups.iter()
                            .find(|rg| rg.id == rg_id)
                            .and_then(|rg| rg.primary_type.as_deref())
                            .unwrap_or("Other")
                            .to_string();
                        matched = Some((rel_id.clone(), rg_id, vec![(release, tracks)], type_name));
                    }
                    Err(e) if e.contains("HTTP 404") => {
                        reporter.info("        ← Album ID not found, trying release group...");
                    }
                    Err(e) if e.contains("unavailable") || e.contains("503") || e.contains("429") => {
                        reporter.warn(&format!("{}: MB unavailable, skipping", local_release.title));
                        continue;
                    }
                    Err(e) => {
                        release_failures += 1;
                        reporter.err(&format!("{}: {}", local_release.title, e));
                        continue;
                    }
                }
            }

            // Tier 2: Release group lookup via MUSICBRAINZ_RELEASEGROUPID (or Tier 1 fallback)
            if matched.is_none() {
                let rg_id_to_try = majority_rg_id.as_deref()
                    .or(majority_release_id.as_deref()); // Tier 1 404 fallback
                if let Some(rg_id) = rg_id_to_try {
                    let api_start = std::time::Instant::now();
                    reporter.info(&format!("        → Browse release group {} (all editions)", rg_id));
                    match mb_api::mb_get_release_tracks(&http_client, rg_id, &mut limiter).await {
                        Ok(releases) if !releases.is_empty() => {
                            reporter.info(&format!(
                                "        ← Found {} edition(s) in {:.1}s",
                                releases.len(),
                                api_start.elapsed().as_secs_f64(),
                            ));
                            let type_name = release_groups.iter()
                                .find(|rg2| rg2.id == rg_id)
                                .and_then(|rg2| rg2.primary_type.as_deref())
                                .unwrap_or("Other")
                                .to_string();
                            matched = Some((String::new(), rg_id.to_string(), releases, type_name));
                        }
                        Ok(_) => {
                            if args.verbose {
                                reporter.skip(&format!("{} (no official releases in group)", local_release.title));
                            }
                        }
                        Err(e) if e.contains("unavailable") || e.contains("503") || e.contains("429") => {
                            reporter.warn(&format!("{}: MB unavailable, skipping", local_release.title));
                            continue;
                        }
                        Err(e) => {
                            release_failures += 1;
                            reporter.err(&format!("{}: {}", local_release.title, e));
                            continue;
                        }
                    }
                }
            }

            // Strict policy: metadata wins. No MB metadata in tags → leave Unmatched.
            // Title fuzzy matching (former Tier 3) is intentionally disabled to avoid
            // collapsing distinct editions onto a single MB release.
            let (tier_release_id, rg_id, mb_release_tracks, type_name) = match matched {
                Some(m) => m,
                None => {
                    mark_local_release_unmatched(&pool, &local_release.id).await.ok();
                    if args.verbose {
                        reporter.skip(&format!("{} (no MB metadata in tags - left Unmatched)", local_release.title));
                    }
                    continue;
                }
            };

            let type_id =
                match ensure_release_type_cached(&pool, &type_name, &mut release_type_cache).await {
                    Ok(id) => id,
                    Err(_) => continue,
                };

            let year = release_groups.iter()
                .find(|rg| rg.id == rg_id)
                .and_then(|rg| rg.first_release_date.as_deref())
                .or_else(|| mb_release_tracks[0].0.date.as_deref())
                .and_then(|d| d.split('-').next())
                .and_then(|y| y.parse::<i32>().ok());

            let local_track_ids: Vec<String> =
                local_tracks.iter().map(|t| t.id.clone()).collect();
            let local_metas: Vec<TrackMeta> =
                local_tracks.iter().map(local_track_to_meta).collect();
            let local_meta_refs: Vec<&TrackMeta> = local_metas.iter().collect();

            let status_check = check_release_status(
                &local_meta_refs,
                &local_track_ids,
                &mb_release_tracks,
                local_release.year,
            );
            let status_str = status_to_db_string(&status_check.status);

            // Strict policy: when a release-group lookup returned multiple siblings and
            // none (or several) match the local track count, refuse to bind a specific
            // edition. Leave the LocalRelease Unmatched so the user can disambiguate
            // by tagging the files with the correct MUSICBRAINZ_ALBUMID.
            if !status_check.is_confident {
                mark_local_release_unmatched(&pool, &local_release.id).await.ok();
                reporter.skip(&format!(
                    "{} ({} MB siblings, no exact track-count match - left Unmatched)",
                    local_release.title,
                    mb_release_tracks.len()
                ));
                continue;
            }

            let best_release = &mb_release_tracks[status_check.best_release_idx].0;
            let best_tracks = &mb_release_tracks[status_check.best_release_idx].1;

            // Use Tier 1 release ID if available, otherwise use best match from status check
            let final_release_id = if !tier_release_id.is_empty() {
                tier_release_id
            } else {
                status_check.best_release_id.clone()
            };
            let disambiguation = status_check.best_release_disambiguation.as_deref();
            let format_str = format_from_media(&best_release.media);
            let rg_first_date = release_groups.iter()
                .find(|rg| rg.id == rg_id)
                .and_then(|rg| rg.first_release_date.as_deref());
            let edition_label = synthesize_edition_label(best_release, rg_first_date);
            let extras = MbReleaseExtras {
                edition_label: edition_label.as_deref(),
                release_date: best_release.date.as_deref(),
                packaging: best_release.packaging.as_deref(),
                country: best_release.country.as_deref(),
                format: format_str.as_deref(),
            };

            let mb_db_id = match upsert_mb_release(
                &pool,
                &final_release_id,
                &rg_id,
                &local_release.title,
                year,
                &type_id,
                status_str,
                None,
                disambiguation,
                &extras,
            )
            .await
            {
                Ok(id) => id,
                Err(e) => {
                    release_failures += 1;
                    reporter.err(&format!("{}: DB error: {}", local_release.title, e));
                    continue;
                }
            };

            ensure_mb_release_artist_link(&pool, &mb_db_id, &artist.id)
                .await
                .ok();

            delete_mb_tracks_for_release(&pool, &mb_db_id).await.ok();

            let track_rows: Vec<MbTrackRow> = best_tracks
                .iter()
                .map(|t| MbTrackRow {
                    title: t.title.clone(),
                    position: t.position.map(|p| p as i32),
                    disc_number: t.disc_number.map(|d| d as i32),
                    duration_ms: t.length.map(|l| l as i32),
                    mb_id: Some(t.id.clone()),
                })
                .collect();

            let inserted_tracks = match batch_insert_mb_tracks(&pool, &mb_db_id, &track_rows).await {
                Ok(t) => t,
                Err(e) => {
                    release_failures += 1;
                    reporter.warn(&format!("{}: track insert failed: {}", local_release.title, e));
                    continue;
                }
            };

            let track_links: Vec<(String, String)> = status_check
                .matched_mb_tracks
                .iter()
                .filter_map(|(mb_track, local_id_opt)| {
                    let local_id = local_id_opt.as_ref()?;
                    let db_id = inserted_tracks
                        .iter()
                        .find(|(_, mid)| mid.as_deref() == Some(mb_track.id.as_str()))
                        .map(|(db_id, _)| db_id.clone())?;
                    Some((local_id.clone(), db_id))
                })
                .collect();
            link_local_tracks_to_mb(&pool, &track_links).await.ok();

            update_local_release_match(&pool, &local_release.id, &mb_db_id, status_str)
                .await
                .ok();

            batch_link_release_genres(&pool, &mb_db_id, &artist_genre_ids)
                .await
                .ok();

            if !args.skip_mb_tags {
                let music_dir = config.music_dir.as_deref().unwrap_or("");
                if !music_dir.is_empty() {
                    let mut local_to_mb_track: HashMap<&str, &str> = HashMap::new();
                    for (mb_track, local_id_opt) in &status_check.matched_mb_tracks {
                        if let Some(local_id) = local_id_opt {
                            local_to_mb_track.insert(local_id.as_str(), mb_track.id.as_str());
                        }
                    }

                    if let Ok(id_paths) = get_track_id_file_paths_for_release(&pool, &local_release.id).await {
                        let mut tags_written = 0u32;
                        for (track_id, rel_path) in &id_paths {
                            let abs_path = std::path::Path::new(music_dir).join(rel_path);
                            if !abs_path.exists() {
                                continue;
                            }
                            let mb_track_id = local_to_mb_track.get(track_id.as_str()).copied();
                            match common::tags::write_mb_ids(
                                &abs_path,
                                Some(&mb_artist.id),
                                Some(&final_release_id),
                                Some(&rg_id),
                                mb_track_id,
                            ) {
                                Ok(true) => { tags_written += 1; }
                                Ok(false) => {}
                                Err(e) => {
                                    if args.verbose {
                                        reporter.warn(&format!("MB tag write {}: {}", rel_path, e));
                                    }
                                }
                            }
                        }
                        if tags_written > 0 {
                            reporter.info(&format!(
                                "        ↳ Wrote MB IDs to {}/{} tracks",
                                tags_written, id_paths.len()
                            ));
                        }
                    }
                }
            }

            if !args.skip_release_img && !local_release.has_cover {
                releases_for_art.push((final_release_id.clone(), rg_id.clone(), local_release.id.clone()));
            }

            let score = match status_check.status {
                status::ReleaseStatus::Complete => 1.0,
                status::ReleaseStatus::ExtraTracks => 0.85,
                status::ReleaseStatus::MissingTracks => 0.7,
                status::ReleaseStatus::Incomplete => 0.5,
            };
            if args.verbose {
                let status_label = match status_check.status {
                    status::ReleaseStatus::Complete => "Complete",
                    status::ReleaseStatus::ExtraTracks => "Extra tracks",
                    status::ReleaseStatus::MissingTracks => "Missing tracks",
                    status::ReleaseStatus::Incomplete => "Incomplete",
                };
                reporter.sub_ok(&format!(
                    "{} - {} ({} local / {} MB tracks)",
                    local_release.title,
                    status_label,
                    local_tracks.len(),
                    best_tracks.len(),
                ));
            }
            score_sum += score;
            score_count += 1;
            newly_synced_count += 1;
            reporter.info(&format!(
                "        ✓ {} done in {:.1}s",
                local_release.title,
                release_start.elapsed().as_secs_f64()
            ));
        }

        // Catalogue gaps: persist MISSING entries for MB release groups without local releases
        if !release_groups.is_empty() && !is_targeted && !is_duplicate {
            delete_missing_releases_for_artist(&pool, &artist.id).await.ok();
            let covered_rg_ids = get_covered_release_group_ids(&pool, &artist.id).await;
            let mut gap_count = 0u32;
            for rg in &release_groups {
                if covered_rg_ids.contains(&rg.id) {
                    continue;
                }
                let type_name = rg.primary_type.as_deref().unwrap_or("Other");
                if type_name != "Album" && type_name != "EP" {
                    continue;
                }
                let type_id = match ensure_release_type_cached(&pool, type_name, &mut release_type_cache).await {
                    Ok(id) => id,
                    Err(_) => continue,
                };
                let year = rg.first_release_date.as_deref()
                    .and_then(|d| d.split('-').next())
                    .and_then(|y| y.parse::<i32>().ok());
                let extras = MbReleaseExtras {
                    release_date: rg.first_release_date.as_deref(),
                    ..Default::default()
                };
                if let Ok(mb_db_id) = upsert_mb_release(
                    &pool, &rg.id, &rg.id, &rg.title, year, &type_id,
                    "MISSING", None, None, &extras,
                ).await {
                    ensure_mb_release_artist_link(&pool, &mb_db_id, &artist.id).await.ok();
                    batch_link_release_genres(&pool, &mb_db_id, &artist_genre_ids).await.ok();
                    gap_count += 1;
                }
            }
            if gap_count > 0 {
                reporter.ok(&format!("{} missing release(s) appended to catalogue", gap_count));
            }
        }

        if !releases_for_art.is_empty() {
            let music_dir = config.music_dir.as_deref().unwrap_or("");
            let release_img_dir = std::path::PathBuf::from(&config.image_dir).join("releases");
            reporter.step(&format!("Downloading cover art ({} releases)...", releases_for_art.len()));
            let mut art_downloaded = 0u32;
            for (rel_id, rg_id, local_release_id) in &releases_for_art {
                let art_start = std::time::Instant::now();
                match download_cover_art(&http_client, rel_id, rg_id).await {
                    Ok(Some(jpeg_bytes)) => {
                        art_downloaded += 1;

                        // Embed cover art into each track's audio file metadata
                        let mut embedded = 0u32;
                        if !music_dir.is_empty() {
                            if let Ok(file_paths) = get_track_file_paths_for_release(&pool, local_release_id).await {
                                for fp in &file_paths {
                                    let abs_path = std::path::Path::new(music_dir).join(fp);
                                    match common::images::embed_cover_art(&abs_path, &jpeg_bytes) {
                                        Ok(true) => { embedded += 1; }
                                        Ok(false) => {}
                                        Err(e) => {
                                            reporter.warn(&format!("Embed art {}: {}", fp, e));
                                        }
                                    }
                                }
                                if embedded > 0 {
                                    reporter.info(&format!(
                                        "      ↳ Embedded cover into {}/{} tracks",
                                        embedded, file_paths.len()
                                    ));

                                    let thumb_path = release_img_dir.join(format!("{}.jpg", local_release_id));
                                    let extracted = file_paths.iter().any(|fp| {
                                        let abs_path = std::path::Path::new(music_dir).join(fp);
                                        common::images::extract_cover_art(&abs_path, &thumb_path)
                                    });

                                    if extracted {
                                        if config.use_local() {
                                            let filename = format!("{}.jpg", local_release_id);
                                            sqlx::query(
                                                r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                            )
                                            .bind(&filename)
                                            .bind(local_release_id)
                                            .execute(&pool)
                                            .await
                                            .ok();
                                        }
                                        if config.use_s3() {
                                            if let (Some(ref client), Some(ref bucket), Some(ref public_url)) =
                                                (&s3_client, &config.storage_bucket, &config.storage_public_url)
                                            {
                                                common::images::upload_release_image_to_s3(
                                                    client, bucket, public_url, &pool, local_release_id, local_release_id, &thumb_path,
                                                ).await;
                                                if !config.use_local() {
                                                    std::fs::remove_file(&thumb_path).ok();
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        reporter.info(&format!(
                            "      ↓ {} cover in {:.1}s",
                            rg_id,
                            art_start.elapsed().as_secs_f64()
                        ));
                    }
                    Ok(None) => {}
                    Err(e) => reporter.warn(&format!("Cover art {}: {}", rg_id, e)),
                }
            }
            if art_downloaded > 0 {
                reporter.ok(&format!("Downloaded {} cover(s)", art_downloaded));
            }
        }

        reporter.clear_transient();

        let avg_score = if score_count > 0 {
            Some(score_sum / score_count as f64)
        } else {
            None
        };

        if is_duplicate {
            let now = chrono::Utc::now().naive_utc();
            sqlx::query(r#"UPDATE "Artist" SET "lastSyncedAt" = $1, "updatedAt" = $1 WHERE id = $2"#)
                .bind(now)
                .bind(&artist.id)
                .execute(&pool)
                .await
                .ok();
        } else {
            update_artist_sync_stats(&pool, &artist.id, &mb_artist.id, avg_score, country_code.as_deref())
                .await
                .ok();
        }

        if !is_targeted {
            if let Ok(n) = cleanup_empty_connected_artists(&pool, &mb_artist.id, &artist.id).await {
                if n > 0 {
                    reporter.info(&format!("Cleaned up {} empty connected artist(s)", n));
                }
            }
        }

        let is_total_failure = score_count == 0 && release_failures > 0;
        if !is_total_failure {
            if let Some(ref h) = run_hash {
                stamp_sync_hash(&pool, &artist.id, h).await;
            }
        }

        if score_count > 0 && release_failures == 0 {
            if newly_synced_count > 0 {
                reporter.ok(&format!("Synced {} release(s)", newly_synced_count));
            } else {
                reporter.skip(&format!("{} release(s) up to date", score_count));
            }
            total_synced += 1;
        } else if score_count > 0 {
            reporter.warn(&format!(
                "{} release(s) synced, {} failed",
                newly_synced_count, release_failures
            ));
            total_partial += 1;
        } else if release_failures > 0 {
            reporter.err("Failed to sync");
            failed_artists.push((
                artist.name.clone(),
                format!("{} error(s)", release_failures),
            ));
        } else {
            reporter.skip("No releases matched");
        }
        reporter.sync_progress(&artist.name, i + 1, total, "done");
        if newly_synced_count > 0 {
            update_statistics(&pool).await.ok();
        }

    }

    if let Ok(n) = delete_empty_local_releases(&pool).await {
        if n > 0 {
            reporter.info(&format!("Cleaned up {} empty local release(s)", n));
        }
    }
    if let Ok(n) = delete_orphaned_mb_releases(&pool).await {
        if n > 0 {
            reporter.info(&format!("Cleaned up {} orphaned MB release(s)", n));
        }
    }
    if let Ok(n) = db::retire_owned_missing_placeholders(&pool).await {
        if n > 0 {
            reporter.info(&format!("Retired {} owned MISSING placeholder(s)", n));
        }
    }
    update_statistics(&pool).await.ok();
    if run_hash.is_some() && running.load(Ordering::SeqCst) {
        clear_run_hash(&pool, "syncRunHash").await;
    }
    release_lock(&pool).await;

    let elapsed = start_time.elapsed();
    let h = elapsed.as_secs() / 3600;
    let m = (elapsed.as_secs() % 3600) / 60;
    let s = elapsed.as_secs() % 60;

    reporter.blank();
    reporter.info(&format!("{}", "═".repeat(60)));
    reporter.blank();
    reporter.done(&format!("Sync complete. ({}h:{:02}m:{:02}s)", h, m, s));
    reporter.info(&format!(
        "  {} synced, {} partial, {} failed",
        total_synced,
        total_partial,
        failed_artists.len()
    ));
    if !failed_artists.is_empty() {
        reporter.blank();
        reporter.info("  Failed artists:");
        for (name, reason) in &failed_artists {
            reporter.err(&format!("    {} - {}", name, reason));
        }
    }
}
