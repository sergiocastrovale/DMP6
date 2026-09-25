use clap::Parser;
use common::config::{apply_db_overrides, load_config};
use common::db::create_pool_or_exit;
use common::filters::matches_filter;
use common::lock::{acquire_lock, clear_stale_lock_minutes, release_lock};
use common::progress::Reporter;
use common::run_hash::{clear_run_hash, get_run_hash, new_run_hash, set_run_hash};
use common::s3::create_s3_client;
use common::statistics::update_statistics;
use futures::stream::StreamExt;
use reqwest::Client;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use dmp_sync::catalogue_gaps;
use dmp_sync::db::*;
use dmp_sync::mb_api::RateLimiter;
use dmp_sync::mb_types;

mod pipeline;
use pipeline::{report_image_result, MAX_IMAGE_TASKS};

#[derive(Parser, Debug)]
#[command(name = "sync")]
pub(crate) struct SyncArgs {
    #[arg(long, short)]
    from: Option<String>,
    #[arg(long, short)]
    to: Option<String>,
    #[arg(long, short, help = "Only sync these artists (semicolon-separated)")]
    only: Option<String>,
    #[arg(long, help = "Re-sync a single release by its LocalRelease ID")]
    release: Option<String>,
    #[arg(
        long,
        help = "With --release: prefer this Artist ID when the release has multiple main artists (e.g. the download's own artist, so a collab release syncs/validates under the artist it was actually downloaded for, not whichever main artist sorts first alphabetically)"
    )]
    artist_hint: Option<String>,
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
    #[arg(
        long,
        help = "Write DB-known MB IDs to file tags (no API calls), then exit"
    )]
    only_write_mb_to_files: bool,
    /// Removed: use `./delete "Artist"` or `./nuke --only "Artist"`.
    #[arg(long, hide = true)]
    delete: bool,
    #[arg(
        long,
        help = "Fast pass: populate MISSING catalogue entries only (few API calls/artist)"
    )]
    catalogue_gaps: bool,
    #[arg(
        long,
        help = "Read artist IDs from file (one per line, used by refresh)"
    )]
    artist_ids: Option<String>,
    #[arg(long)]
    verbose: bool,
    #[arg(
        long,
        default_value_t = DEFAULT_CONCURRENCY,
        help = "How many artists to sync at once. All workers share one MusicBrainz pacing schedule, so this changes how much of the rate allowance is used, never the rate itself"
    )]
    concurrency: usize,
    /// Emit PROGRESS:{json} lines and plain output for the web terminal.
    /// Default is pretty colored console output.
    #[arg(long)]
    web: bool,
}

// Acceptance gate for a Tier-3 search hit: strong MB score, the found release-group title is similar
// to the local album, and the type passes the album/EP-only allow-list. Track-count confidence is
// enforced later by check_release_status when the chosen edition is scored.
pub(crate) const SEARCH_MIN_SCORE: u32 = 85;

/// How many artists are synced at once.
///
/// MusicBrainz is latency-bound for this workload, not rate-bound: a cold query averages ~10s, so a
/// strictly serial client sits idle ~85% of the time and reaches only ~0.15 req/s of its ~0.91 req/s
/// allowance. Workers overlap that waiting. They do **not** overlap the rate: every request still
/// takes a slot from the one shared `RateLimiter` schedule (see `common::mb::api`), so K workers
/// issue at exactly the same requests-per-second one worker would - they just stop leaving the wire
/// idle between them.
///
/// At ~10s latency the schedule saturates around 9 in flight; past that the slot spacing binds and
/// extra workers buy nothing.
const DEFAULT_CONCURRENCY: usize = 6;

#[tokio::main]
async fn main() {
    let args = SyncArgs::parse();
    common::error_log::init("sync");
    if args.delete {
        common::progress::early_err(
            "--delete was removed: use ./delete \"Artist\" or ./nuke --only \"Artist\"",
        );
        std::process::exit(2);
    }
    let reporter = Reporter::new(args.web);
    let mut config = load_config(None);
    let pool = create_pool_or_exit(&config.database_url, "sync").await;
    apply_db_overrides(&mut config, &pool).await;

    if args.release.is_some() && (args.from.is_some() || args.to.is_some() || args.only.is_some()) {
        common::error_log::log_error("--release cannot be combined with --from, --to, or --only");
        reporter.failed("--release cannot be combined with --from, --to, or --only");
        std::process::exit(1);
    }

    if args.catalogue_gaps && args.release.is_some() {
        common::error_log::log_error("--catalogue-gaps cannot be combined with --release");
        reporter.failed("--catalogue-gaps cannot be combined with --release");
        std::process::exit(1);
    }

    if args.only_write_mb_to_files && (args.release.is_some() || args.catalogue_gaps) {
        common::error_log::log_error(
            "--only-write-mb-to-files cannot be combined with --release or --catalogue-gaps",
        );
        reporter.failed(
            "--only-write-mb-to-files cannot be combined with --release or --catalogue-gaps",
        );
        std::process::exit(1);
    }

    if clear_stale_lock_minutes(&pool, common::lock::STALE_LOCK_MINUTES).await {
        reporter.warn("Cleared stale scan lock.");
    }

    let pid = std::process::id();
    let _lock_guard = match acquire_lock(&pool, "sync", pid).await {
        Ok(g) => g,
        Err(e) => {
            reporter.err(&format!("Cannot start: {}", e));
            std::process::exit(1);
        }
    };

    let running = common::app::spawn_shutdown_handlers(&pool, "sync", "artist", 0);

    let s3_client = create_s3_client(&config).await;

    // 60s, not 30: a cold `inc=recordings` browse was measured at 29.8s, so a 30s ceiling was
    // clipping legitimate responses - and doing so more often once requests overlap. `mb_get` retries
    // a timeout now either way, but timing out a request MusicBrainz was about to answer wastes the
    // slot it already paid for.
    let http_client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("HTTP client");

    let mut limiter = RateLimiter::new();

    if args.catalogue_gaps {
        reporter.header("DMP Sync - Catalogue Gaps");
        reporter.kv(
            "Mode",
            "catalogue-gaps (MISSING entries only, few API calls/artist)",
        );
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
            catalogue_gaps::GapFillContext {
                pool: &pool,
                http_client: &http_client,
                limiter: &mut limiter,
                reporter: &reporter,
                running: &running,
            },
            catalogue_gaps::ArtistFilter {
                from: args.from.as_deref(),
                to: args.to.as_deref(),
                only: args.only.as_deref(),
                exact: args.exact,
            },
            args.overwrite,
            args.verbose,
            None,
        )
        .await
        {
            Ok((artists, gaps, processed_artist_ids)) => {
                // Scoped to the artists this run actually touched, matching the scoping discipline of
                // the main sync tail (see cleanup_scope below) - unscoped would delete unbound MB
                // releases for artists a `--only`/`--from`/`--to` run never looked at. See
                // `catalogue_gaps::finish_run` for why the ordering inside it matters.
                let gaps_scope: Option<Vec<String>> =
                    (args.only.is_some() || args.from.is_some() || args.to.is_some())
                        .then_some(processed_artist_ids);
                catalogue_gaps::finish_run(&pool, gaps_scope.as_deref(), &reporter).await;
                reporter.blank();
                reporter.done(&format!(
                    "Catalogue gaps complete: {} artist(s) processed, {} gap(s) recorded",
                    artists, gaps
                ));
            }
            Err(e) => reporter.err(&format!("Catalogue gaps error: {}", e)),
        }
        release_lock(&pool, "sync", std::process::id()).await;
        return;
    }

    if args.only_write_mb_to_files {
        let music_dir = config.music_dir.as_deref().unwrap_or("");
        if music_dir.is_empty() {
            reporter.err("No music_dir configured - cannot write to files");
            release_lock(&pool, "sync", std::process::id()).await;
            std::process::exit(1);
        }

        reporter.header("DMP Sync - Write MB IDs to Files");

        let rows: Vec<(String, String, String, Option<String>)> = common::lock::expect_or_release(
            &pool,
            "sync",
            pid,
            sqlx::query_as(
                r#"SELECT id, name, slug, "musicbrainzId" FROM "Artist"
                       WHERE "musicbrainzId" IS NOT NULL
                       ORDER BY name"#,
            )
            .fetch_all(&pool)
            .await,
            "DB query failed",
        )
        .await;

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
                let ids = common::tags::MbTagIds {
                    album_artist: Some(mb_artist_id),
                    album: Some(&track.mb_release_id),
                    release_group: Some(&track.mb_release_group_id),
                    release_track: track.mb_track_id.as_deref(),
                    recording: track.mb_recording_id.as_deref(),
                };
                match common::tags::write_mb_ids(&abs_path, &ids, args.overwrite) {
                    Ok(true) => {
                        written += 1;
                    }
                    Ok(false) => {}
                    Err(e) => {
                        reporter.warn(&format!("{}: {}", track.file_path, e));
                    }
                }
            }

            if written > 0 {
                reporter.ok(&format!(
                    "[{}/{}] {} - wrote {}/{} tracks",
                    i + 1,
                    total,
                    artist_name,
                    written,
                    tracks.len()
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
        release_lock(&pool, "sync", std::process::id()).await;
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
                reporter.info(&format!(
                    "Resuming run (hash: {})",
                    h.get(..8).unwrap_or(&h)
                ));
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
        reporter.info(&format!(
            "Skipping {} already-processed artist(s)",
            already_synced.len()
        ));
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
        match get_artist_for_release(&pool, release_id, args.artist_hint.as_deref()).await {
            Ok(Some(artist)) => {
                reporter.info(&format!("Release {} → artist: {}", release_id, artist.name));
                vec![artist]
            }
            Ok(None) => {
                reporter.err(&format!(
                    "Release '{}' not found or has no artist",
                    release_id
                ));
                release_lock(&pool, "sync", std::process::id()).await;
                std::process::exit(1);
            }
            Err(e) => {
                reporter.err(&format!(
                    "DB error looking up release '{}': {}",
                    release_id, e
                ));
                release_lock(&pool, "sync", std::process::id()).await;
                std::process::exit(1);
            }
        }
    } else if let Some(ref ids_path) = args.artist_ids {
        let content = std::fs::read_to_string(ids_path)
            .unwrap_or_else(|e| panic!("Failed to read artist IDs file '{}': {}", ids_path, e));
        let ids: Vec<String> = content
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect();
        if ids.is_empty() {
            vec![]
        } else {
            let rows: Vec<ArtistImageRow> = common::lock::expect_or_release(
                &pool,
                "sync",
                pid,
                sqlx::query_as(
                    r#"SELECT id, name, slug, "musicbrainzId", image, "imageUrl" FROM "Artist" WHERE id = ANY($1::text[])"#,
                )
                .bind(&ids)
                .fetch_all(&pool)
                .await,
                "DB query failed",
            )
            .await;
            rows.into_iter().map(ArtistSyncRow::from).collect()
        }
    } else if args.overwrite {
        let rows: Vec<ArtistImageRow> = common::lock::expect_or_release(
            &pool,
            "sync",
            pid,
            sqlx::query_as(
                r#"SELECT id, name, slug, "musicbrainzId", image, "imageUrl" FROM "Artist" ORDER BY name"#,
            )
            .fetch_all(&pool)
            .await,
            "DB query failed",
        )
        .await;

        rows.into_iter()
            .filter(|row| {
                matches_filter(
                    &row.name,
                    args.from.as_deref().unwrap_or(""),
                    args.to.as_deref().unwrap_or(""),
                    args.only.as_deref().unwrap_or(""),
                    args.exact,
                )
            })
            .map(ArtistSyncRow::from)
            .collect()
    } else {
        common::lock::expect_or_release(
            &pool,
            "sync",
            pid,
            get_artists_pending_sync(&pool).await,
            "DB query failed",
        )
        .await
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
    let has_filter = args.only.is_some()
        || args.from.is_some()
        || args.to.is_some()
        || args.artist_ids.is_some();
    if has_filter && !artists.is_empty() {
        let primary_ids: Vec<String> = artists.iter().map(|a| a.id.clone()).collect();
        let connected: Vec<ArtistImageRow> = sqlx::query_as(
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
        for row in connected {
            if !existing_ids.contains(&row.id) {
                artists.push(ArtistSyncRow::from(row));
                added += 1;
            }
        }
        if added > 0 {
            reporter.info(&format!("Including {} linked artist(s)", added));
        }
    }

    let total = artists.len();
    reporter.info(&format!("Syncing {} artist(s)...", total));

    // Every artist without a musicbrainzId falls into the search ladder, which would otherwise re-ask
    // MusicBrainz for names the index resolver already answered. One query up front replaces a point
    // lookup per artist; tags discovered mid-ladder still fall back to those. Read-only - see
    // `common::mb::cache` for why sync must never write here.
    let warmed_artist_names: HashMap<String, mb_types::MbArtistMatch> = {
        let names: Vec<String> = artists
            .iter()
            .filter(|a| a.mb_id.as_deref().unwrap_or("").is_empty())
            .map(|a| a.name.clone())
            .collect();
        let warmed = common::mb::cache::warm_exact_artists(&pool, &names).await;
        if !warmed.is_empty() {
            reporter.info(&format!(
                "{} of {} unmatched artist(s) already resolved in cache - no search needed",
                warmed.len(),
                names.len()
            ));
        }
        warmed
    };
    reporter.blank();

    let start_time = std::time::Instant::now();

    // Artist image downloads run off the critical path - they never touch MB's rate budget, so there
    // is no reason for the MusicBrainz loop to wait on them.
    let image_tasks: pipeline::ImageTasks =
        Arc::new(tokio::sync::Mutex::new(tokio::task::JoinSet::new()));
    // The `MAX_IMAGE_TASKS` cap now lives on a semaphore rather than on "block until the JoinSet
    // drains". Blocking was fine when one artist ran at a time; with workers sharing the JoinSet it
    // would mean holding its lock across a 30s download and stalling every other worker behind it.
    // The permit is taken *inside* the spawned task, so the cap still holds and no lock is held
    // across an await.
    let image_slots = Arc::new(tokio::sync::Semaphore::new(MAX_IMAGE_TASKS));

    // MB ID → DB artist ID: detect duplicate artists resolving to the same MB ID. Shared, and the
    // lock is held across the whole check-and-claim below - see there for why.
    let synced_mb_ids: Arc<tokio::sync::Mutex<HashMap<String, String>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    // Shared so a duplicate artist still reuses its primary's browse even when the two land on
    // different workers - that reuse is worth a paginated MusicBrainz call. Never locked across an
    // await: read-and-clone, or insert, and release.
    let release_group_cache: Arc<
        tokio::sync::Mutex<HashMap<String, Vec<mb_types::MbReleaseGroup>>>,
    > = Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    let concurrency = args.concurrency.clamp(1, 16);
    if concurrency > 1 {
        reporter.kv(
            "Concurrency",
            &format!(
                "{} artists at once (shared 1 req/s MusicBrainz schedule)",
                concurrency
            ),
        );
    }

    let outcomes: Vec<pipeline::ArtistOutcome> = futures::stream::iter(artists.iter().enumerate())
        .map(|(i, artist)| {
            // A clone of the limiter is a handle onto the *same* pacing schedule, not a new one.
            // Cheap handle clones (Arc inside) otherwise, not copies of the data.
            let ctx = pipeline::ArtistWorkerCtx {
                args: &args,
                warmed_artist_names: &warmed_artist_names,
                already_synced: &already_synced,
                run_hash: &run_hash,
                target_release_id: &target_release_id,
                reporter: reporter.clone(),
                pool: pool.clone(),
                http_client: http_client.clone(),
                s3_client: s3_client.clone(),
                config: config.clone(),
                running: running.clone(),
                limiter: limiter.clone(),
                image_tasks: image_tasks.clone(),
                image_slots: image_slots.clone(),
                synced_mb_ids: synced_mb_ids.clone(),
                release_group_cache: release_group_cache.clone(),
            };
            pipeline::process_artist(i, artist, total, ctx)
        })
        .buffer_unordered(concurrency)
        .collect()
        .await;

    let mut total_synced = 0usize;
    let mut total_partial = 0usize;
    let mut failed_artists: Vec<(String, String)> = Vec::new();
    for o in outcomes {
        if o.synced {
            total_synced += 1;
        }
        if o.partial {
            total_partial += 1;
        }
        if let Some(f) = o.failed {
            failed_artists.push(f);
        }
    }

    {
        let mut tasks = image_tasks.lock().await;
        if !tasks.is_empty() {
            if running.load(Ordering::SeqCst) {
                reporter.info(&format!(
                    "Finishing {} artist image download(s)...",
                    tasks.len()
                ));
                while let Some(joined) = tasks.join_next().await {
                    if let Ok((name, result)) = joined {
                        report_image_result(&reporter, &name, &result);
                    }
                }
            } else {
                // Ctrl-C: an abandoned download costs nothing. The fetch is gated on
                // `!artist.has_image`, so the next run simply picks it up again.
                tasks.abort_all();
            }
        }
    }

    // Library-wide repair (empty/orphaned release cleanup, box-set binding + equivalence, artist
    // identity repair, score recompute) no longer lives here - `./tidy` does every library-wide pass
    // in one run, chained after sync by every caller (docs/scripts/tidy.md).
    update_statistics(&pool).await.ok();
    if run_hash.is_some() && running.load(Ordering::SeqCst) {
        clear_run_hash(&pool, "syncRunHash").await;
    }
    release_lock(&pool, "sync", std::process::id()).await;

    let elapsed = start_time.elapsed();
    let h = elapsed.as_secs() / 3600;
    let m = (elapsed.as_secs() % 3600) / 60;
    let s = elapsed.as_secs() % 60;

    reporter.blank();
    reporter.info(&"═".repeat(60).to_string());
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
