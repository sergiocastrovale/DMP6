mod images;
mod metadata;
mod nuke;

use chrono::{NaiveDateTime, Utc};
use clap::Parser;
use common::{
    checkpoint::{clear_index_checkpoint, load_index_checkpoint, save_index_checkpoint},
    config::{apply_db_overrides, load_config},
    db::{create_pool, ensure_artist_cached},
    filters::{escape_like, matches_filter},
    lock::{acquire_lock, clear_stale_lock_minutes, release_lock},
    progress::Reporter,
    run_hash::{clear_run_hash, get_run_hash, new_run_hash, set_run_hash},
    s3::{create_s3_client, upload_to_s3},
    statistics::update_statistics,
    totals::{update_artist_totals_for_artist, update_release_totals_for_artist},
};
use futures::stream::{FuturesUnordered, StreamExt};
use jwalk::WalkDir;
use rayon::prelude::*;
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use common::mb::resolve::LookupResult;
use images::{hash_image_file, resolve_release_cover, upload_release_image_to_s3};
use index::db::*;
use index::deletion::{
    delete_empty_releases, delete_orphan_artists, delete_orphaned_mb_releases,
    delete_removed_tracks, detect_deleted_folders, dropped_links_line,
};
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

    #[arg(
        long,
        short,
        help = "Only process these artist folders (semicolon-separated)"
    )]
    only: Option<String>,

    #[arg(
        long,
        help = "Only index these exact folder paths relative to MUSIC_DIR (semicolon-separated)"
    )]
    folders: Option<String>,

    #[arg(long, help = "Re-index a single release by its LocalRelease ID")]
    release: Option<String>,

    #[arg(long, help = "Re-index all tracks, ignoring change detection")]
    overwrite: bool,

    #[arg(long, help = "Re-index all tracks AND re-extract all cover art")]
    overwrite_with_images: bool,

    #[arg(
        long,
        help = "Delete DB rows for files missing on disk even when most of the folder changed (bypasses the mount-blip ratio guard)"
    )]
    prune: bool,

    #[arg(long, help = "Exact match for --only (no prefix matching)")]
    exact: bool,

    #[arg(
        long,
        help = "Re-check existing files for metadata changes (size/mtime/hash comparison)"
    )]
    inspect: bool,

    #[arg(long, help = "Skip cover art extraction")]
    skip_covers: bool,

    #[arg(long, help = "Resume from last saved checkpoint")]
    resume: bool,

    #[arg(long, help = "Delete all local data for matched artists, then exit")]
    delete: bool,

    #[arg(
        long,
        default_value = "8",
        help = "Rayon thread count for parallel extraction"
    )]
    threads: usize,

    #[arg(long, help = "Override MUSIC_DIR from env")]
    music_dir: Option<String>,

    #[arg(
        long,
        help = "Emit PROGRESS:{json} lines for the web terminal (default: pretty console)"
    )]
    web: bool,

    #[arg(
        long,
        help = "Write processed artist IDs to file (one per line, used by refresh)"
    )]
    emit_artist_ids: Option<String>,

    #[arg(
        long,
        help = "Only resolve artist tags against MusicBrainz and rebuild links, then exit (no folder scan)"
    )]
    resolve_artists: bool,

    #[arg(
        long,
        help = "With --resolve-artists: print the decisions without writing anything"
    )]
    dry_run: bool,

    #[arg(long, help = "Skip the end-of-run artist resolution pass")]
    skip_resolve: bool,

    #[arg(
        long,
        help = "Only reconcile Artist rows with MusicBrainz (clear contradicted ids, rename to the canonical name, connect duplicates, sweep orphans), then exit. No network, no folder scan"
    )]
    canonicalize_artists: bool,
}

fn has_filter(args: &IndexArgs) -> bool {
    args.from.is_some()
        || args.to.is_some()
        || args.only.is_some()
        || args.folders.is_some()
        || args.release.is_some()
}

/// Release ids a filtered run should confine artist resolution to, or `None` for the whole library.
///
/// Used by `--resolve-artists` and `--canonicalize-artists`, neither of which has a folder scan to
/// collect touched artist ids from, so both derive the scope from the filter itself. Reuses
/// `matches_filter` - the same helper `nuke_local_artists` applies - so `--only`/`--from`/`--to`/
/// `--exact` mean exactly what they mean everywhere else.
///
/// Never returns `None` once any filter is set, which is load-bearing: `None` means "the whole library"
/// downstream, so a `--folders` run that fell through to it would canonicalize all ~54k artists behind
/// a single release's refresh button.
async fn scoped_release_ids_for_filter(
    pool: &sqlx::PgPool,
    args: &IndexArgs,
) -> Option<Vec<String>> {
    if !has_filter(args) {
        return None;
    }

    if let Some(ref release_id) = args.release {
        return Some(vec![release_id.clone()]);
    }

    if let Some(ref folders) = args.folders {
        let paths: Vec<String> = folders
            .split(';')
            .map(|f| f.trim().to_string())
            .filter(|f| !f.is_empty())
            .collect();
        let rows: Vec<(String,)> =
            sqlx::query_as(r#"SELECT id FROM "LocalRelease" WHERE "folderPath" = ANY($1::text[])"#)
                .bind(&paths)
                .fetch_all(pool)
                .await
                .unwrap_or_default();
        return Some(rows.into_iter().map(|(id,)| id).collect());
    }

    let artists: Vec<(String, String)> = sqlx::query_as(r#"SELECT id, name FROM "Artist""#)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    let target_ids: Vec<String> = artists
        .into_iter()
        .filter(|(_, name)| {
            matches_filter(
                name,
                args.from.as_deref().unwrap_or(""),
                args.to.as_deref().unwrap_or(""),
                args.only.as_deref().unwrap_or(""),
                args.exact,
            )
        })
        .map(|(id, _)| id)
        .collect();

    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT lra."localReleaseId" FROM "LocalReleaseArtist" lra
           WHERE lra."artistId" = ANY($1::text[])"#,
    )
    .bind(&target_ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    Some(rows.into_iter().map(|(id,)| id).collect())
}

/// Decide artist identity for every tag in scope and write the resulting owner/credit links.
/// With `dry_run` nothing is written - the decisions are printed instead, which is the intended way to
/// inspect what a full run would do before paying for it.
///
/// Two phases, deliberately separated. Phase A walks the sorted distinct tag values and asks
/// MusicBrainz about each; Phase B walks the tracks and writes links, entirely offline because Phase A
/// has already memoized every name. The split is what makes progress alphabetical, the counter honest,
/// and a crash cheap - every answer Phase A obtained is already in `MbArtistLookup`, so a rerun starts
/// where the last one stopped.
///
/// `overwrite` skips the cache warm, which is all it takes to force a full re-ask: an empty memo pins
/// nothing, and `persist_lookup` upserts over the stale rows.
async fn run_artist_resolution(
    pool: &sqlx::PgPool,
    config: &common::config::Config,
    reporter: &Reporter,
    dry_run: bool,
    scoped_release_ids: Option<&[String]>,
    overwrite: bool,
) {
    use index::resolve::{distinct_tag_values, resolve_and_apply, ArtistResolver};

    // Captured BEFORE the pass runs: the reconcile is what unlinks an artist, so afterwards there is
    // nothing left to join on. `None` means the whole library, matching the folder loop's convention.
    let linked_before: Option<Vec<String>> = match scoped_release_ids {
        Some(ids) => Some(artists_linked_to_releases(pool, ids).await),
        None => None,
    };

    let mut resolver = ArtistResolver::new(pool, dry_run);
    let names = distinct_tag_values(pool, scoped_release_ids).await;
    if !overwrite {
        resolver.warm_cache().await;
    }
    let pending: Vec<String> = names
        .iter()
        .filter(|n| !resolver.is_cached(n))
        .cloned()
        .collect();
    reporter.info(&format!(
        "Resolving {} of {} distinct artist tag value(s) ({} already resolved){}...",
        pending.len(),
        names.len(),
        names.len() - pending.len(),
        if dry_run {
            " (dry run - no writes)"
        } else {
            ""
        }
    ));

    resolver.prefetch(&pending, Some(reporter)).await;

    let mut report: Vec<index::resolve::Decision> = Vec::new();
    let result = resolve_and_apply(
        pool,
        &mut resolver,
        scoped_release_ids,
        &mut report,
        Some(reporter),
    )
    .await;
    reporter.clear_transient();
    if let Err(e) = result {
        reporter.err(&format!("Artist resolution failed: {}", e));
        return;
    }

    if dry_run {
        for decision in &report {
            let parts: Vec<String> = decision
                .parts
                .iter()
                .map(|p| {
                    format!(
                        "{}{}{}",
                        p.name,
                        if p.verified { "" } else { "?" },
                        if p.role == common::mb::resolve::JoinKind::Guest {
                            " (credit)"
                        } else {
                            ""
                        }
                    )
                })
                .collect();
            println!(
                "  {}  ->  {}  [{}]",
                decision.name,
                parts.join(" + "),
                decision.source.as_str()
            );
        }
        println!();
        println!("  (a trailing ? marks an unverified name - kept as an artist only when it owns a release)");
    }

    let s = &resolver.stats;
    reporter.info(&format!(
        "Resolved {} name(s): {} embedded, {} cached, {} whole-name MB, {} split MB, {} fallback, {} deferred ({} MB lookups).",
        s.names_seen, s.from_embedded, s.from_cache, s.from_mb_whole, s.from_mb_span, s.from_fallback,
        s.deferred, s.mb_lookups
    ));
    // Reported once, as a fact about MusicBrainz's health rather than a problem with this run: these
    // all recovered on retry. Only `deferred` above counts names that actually failed.
    let absorbed = resolver.absorbed_503s();
    if absorbed > 0 {
        reporter.info(&format!(
            "Absorbed {} transient MusicBrainz 503(s) (server busy, retried successfully).",
            absorbed
        ));
    }

    // The pass has just decided who every tag names; this is the moment to make the Artist rows agree,
    // and to sweep whatever the reconcile left holding nothing.
    //
    // The scope is the union of before and after: `before` holds the rows the reconcile may have
    // stranded, `after` holds the ones it just created (a credit artist that did not exist when the pass
    // started still needs its name canonicalized).
    let scope: Option<Vec<String>> = match (linked_before, scoped_release_ids) {
        (Some(before), Some(ids)) => {
            let mut all: HashSet<String> = before.into_iter().collect();
            all.extend(artists_linked_to_releases(pool, ids).await);
            Some(all.into_iter().collect())
        }
        _ => None,
    };
    run_canonicalize(pool, config, reporter, dry_run, scope.as_deref()).await;
}

/// Artists currently linked to `release_ids`, as owners or as track credits. The orphan sweep's scope
/// on a filtered run: exactly the rows this pass could plausibly strand, and nothing else.
async fn artists_linked_to_releases(pool: &sqlx::PgPool, release_ids: &[String]) -> Vec<String> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT DISTINCT lra."artistId" FROM "LocalReleaseArtist" lra
           WHERE lra."localReleaseId" = ANY($1::text[])
           UNION
           SELECT DISTINCT tra."artistId" FROM "TrackRelatedArtist" tra
           JOIN "LocalReleaseTrack" t ON t.id = tra."trackId"
           WHERE t."localReleaseId" = ANY($1::text[])"#,
    )
    .bind(release_ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter().map(|(id,)| id).collect()
}

/// Reconcile Artist rows with MusicBrainz, then delete whatever ends up linked to nothing.
///
/// Pure SQL against `MbArtistLookup` - no network, no audio files - which is what makes it usable as a
/// standalone repair (`--canonicalize-artists`) on a library that cannot afford a re-index.
async fn run_canonicalize(
    pool: &sqlx::PgPool,
    config: &common::config::Config,
    reporter: &Reporter,
    dry_run: bool,
    scope: index::deletion::ArtistScope<'_>,
) {
    let (stats, report) = match index::canonicalize::canonicalize_artists(pool, scope, dry_run).await
    {
        Ok(v) => v,
        Err(e) => {
            reporter.err(&format!("Artist canonicalization failed: {}", e));
            return;
        }
    };

    if dry_run {
        for name in &report.mbids_cleared {
            println!("  clear mbid  {}", name);
        }
        for r in &report.renames {
            println!(
                "  rename      {}  ->  {}{}",
                r.from,
                r.to,
                if r.slug_changes { "  (slug changes)" } else { "" }
            );
        }
        for c in &report.connections {
            println!("  connect     {}  ->  {}  [{}]", c.duplicate, c.primary, c.mbid);
        }
        if !report.mbids_cleared.is_empty() || !report.renames.is_empty() || !report.connections.is_empty() {
            println!();
        }
    }

    if !stats.is_empty() {
        reporter.info(&format!(
            "Canonicalized artists: {} contradicted MB id(s) cleared, {} renamed to the MusicBrainz name, {} connected to a primary{}.",
            stats.mbids_cleared, stats.renamed, stats.connected,
            if dry_run { " (dry run - no writes)" } else { "" }
        ));
    }

    if dry_run {
        return;
    }
    let swept = index::deletion::delete_orphan_artists(pool, config, scope).await;
    if swept > 0 {
        reporter.info(&format!("Deleted {} artist(s) left linked to nothing.", swept));
    }
}

#[tokio::main]
async fn main() {
    let mut args = IndexArgs::parse();
    if args.overwrite_with_images {
        args.overwrite = true;
    }
    common::error_log::init("index");
    let reporter = Reporter::new(args.web);
    let mut config = load_config(args.music_dir.as_deref());
    let pool = create_pool(&config.database_url).await;
    apply_db_overrides(&mut config, &pool).await;
    let music_dir = config.require_music_dir().to_string();

    if args.release.is_some()
        && (args.from.is_some()
            || args.to.is_some()
            || args.only.is_some()
            || args.folders.is_some())
    {
        common::error_log::log_error(
            "--release cannot be combined with --from, --to, --only, or --folders",
        );
        eprintln!("Error: --release cannot be combined with --from, --to, --only, or --folders");
        std::process::exit(1);
    }

    let resolved_folders_from_release: Option<String> = if let Some(ref release_id) = args.release {
        let row: Option<(Option<String>,)> =
            sqlx::query_as(r#"SELECT "folderPath" FROM "LocalRelease" WHERE id = $1"#)
                .bind(release_id)
                .fetch_optional(&pool)
                .await
                .unwrap_or(None);

        match row {
            Some((Some(folder_path),)) if !folder_path.is_empty() => Some(folder_path),
            _ => {
                common::error_log::log_error(&format!(
                    "release '{}' not found or has no folderPath",
                    release_id
                ));
                eprintln!(
                    "Error: release '{}' not found or has no folderPath",
                    release_id
                );
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
        "from={} to={} only={} overwrite={} inspect={} delete={} prune={} release={}",
        args.from.as_deref().unwrap_or(""),
        args.to.as_deref().unwrap_or(""),
        args.only.as_deref().unwrap_or(""),
        args.overwrite,
        args.inspect,
        args.delete,
        args.prune,
        args.release.as_deref().unwrap_or(""),
    );
    if let Err(e) = acquire_lock(&pool, "index", std::process::id(), &args_str).await {
        reporter.err(&format!("Cannot start: {}", e));
        std::process::exit(1);
    }

    // SIGTERM / Ctrl-C handler - release lock before exiting
    let shutdown = Arc::new(AtomicBool::new(false));
    {
        let shutdown = shutdown.clone();
        let pool = pool.clone();
        tokio::spawn(async move {
            tokio::signal::ctrl_c().await.ok();
            shutdown.store(true, Ordering::SeqCst);
            eprintln!("\nShutdown requested - finishing current folder...");
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
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
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
        match nuke_local_artists(
            &pool,
            from,
            to,
            only,
            args.exact,
            &project_root,
            &s3_client,
            &config,
        )
        .await
        {
            Ok(n) => reporter.info(&format!("Deleted {} artist(s).", n)),
            Err(e) => reporter.err(&format!("Delete error: {}", e)),
        }
        release_lock(&pool).await;
        return;
    }

    // -------------------------------------------------------------------------
    // Resolve-only mode: decide artist identity against MusicBrainz, no folder scan
    // -------------------------------------------------------------------------
    if args.resolve_artists {
        let scoped = scoped_release_ids_for_filter(&pool, &args).await;
        run_artist_resolution(
            &pool,
            &config,
            &reporter,
            args.dry_run,
            scoped.as_deref(),
            args.overwrite,
        )
        .await;
        release_lock(&pool).await;
        return;
    }

    // -------------------------------------------------------------------------
    // Canonicalize-only mode: reconcile Artist rows with MusicBrainz, no network, no folder scan
    // -------------------------------------------------------------------------
    if args.canonicalize_artists {
        let scoped = scoped_release_ids_for_filter(&pool, &args).await;
        let scope: Option<Vec<String>> = match scoped.as_deref() {
            Some(ids) => Some(artists_linked_to_releases(&pool, ids).await),
            None => None,
        };
        run_canonicalize(&pool, &config, &reporter, args.dry_run, scope.as_deref()).await;
        release_lock(&pool).await;
        return;
    }

    // -------------------------------------------------------------------------
    // Run hash for resumability
    // -------------------------------------------------------------------------
    let is_targeted = args.release.is_some() || args.folders.is_some();
    let run_hash: Option<String> = if is_targeted {
        None
    } else if args.overwrite || args.overwrite_with_images {
        let h = new_run_hash();
        set_run_hash(&pool, "indexRunHash", &h).await;
        Some(h)
    } else {
        match get_run_hash(&pool, "indexRunHash").await {
            Some(h) => {
                reporter.info(&format!("Resuming run (hash: {})", &h[..8]));
                Some(h)
            }
            None => {
                let h = new_run_hash();
                set_run_hash(&pool, "indexRunHash", &h).await;
                Some(h)
            }
        }
    };

    let already_indexed: HashSet<String> = if let Some(ref h) = run_hash {
        load_indexed_folders(&pool, h).await
    } else {
        HashSet::new()
    };
    if !already_indexed.is_empty() {
        reporter.info(&format!(
            "Skipping {} already-processed folder(s)",
            already_indexed.len()
        ));
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

    // Everything MusicBrainz has already told us about a name, loaded once so the folder scan can
    // resolve album artists without a single network call. Empty after a nuke, in which case album
    // artists fall back to the raw tag and the post-loop pass corrects them.
    //
    // Deliberately unscoped even on a filtered run: the names this scan will ask about come out of the
    // files as they are read, so there is nothing to filter on until it is too late to batch. One query
    // for the table beats a round trip per name. Same reasoning as the slug map above.
    let lookup_memo: HashMap<String, LookupResult> = {
        let rows: Vec<(String, Option<String>)> =
            sqlx::query_as(r#"SELECT name, mbid FROM "MbArtistLookup""#)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();
        rows.into_iter()
            .map(|(name, mbid)| {
                let result = match mbid {
                    Some(id) => LookupResult::Found { mbid: Some(id) },
                    None => LookupResult::NotFound,
                };
                (name, result)
            })
            .collect()
    };

    let mut release_cache: HashMap<String, String> = {
        let rows: Vec<(String, String)> =
            sqlx::query_as(r#"SELECT "groupKey", id FROM "LocalRelease""#)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();
        rows.into_iter().collect()
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
                    map.entry(artist.to_string())
                        .or_default()
                        .push(folder.to_string());
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
            .filter(|name| matches_filter(name, from, to, only, args.exact))
            .collect()
    };

    // Expand with connected (linked) artists' folders when filtering
    let is_filtered = !only.is_empty() || !from.is_empty() || !to.is_empty();
    if is_filtered && !artist_folders.is_empty() && target_folders.is_none() {
        let folder_names = artist_folders.clone();
        let connected_folders: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT SPLIT_PART(lr."folderPath", '/', 1)
               FROM "Artist" ca
               JOIN "Artist" pa ON ca."primaryArtistId" = pa.id
               JOIN "LocalReleaseArtist" lra ON lra."artistId" = ca.id
               JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
               WHERE pa.name = ANY($1::text[])
                 AND lr."folderPath" IS NOT NULL"#,
        )
        .bind(&folder_names)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        let existing: HashSet<String> = artist_folders.iter().cloned().collect();
        let mut added = 0usize;
        for (folder,) in connected_folders {
            if !folder.is_empty() && !existing.contains(&folder) {
                let folder_path = std::path::Path::new(&music_dir).join(&folder);
                if folder_path.is_dir() {
                    artist_folders.push(folder);
                    added += 1;
                }
            }
        }
        if added > 0 {
            reporter.info(&format!("Including {} linked artist folder(s)", added));
        }
    }

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
    reporter.kv(
        "Threads",
        &if args.threads > 0 {
            args.threads.to_string()
        } else {
            "8".into()
        },
    );
    if args.overwrite {
        reporter.kv("Mode", "overwrite");
    } else if args.inspect {
        reporter.kv("Mode", "inspect (re-check metadata)");
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
            if total_folders == 1 {
                " folder"
            } else {
                " folders"
            }
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
    // Favorites / playlist entries that cascaded away with tracks whose files disappeared. Surfaced in
    // the run summary (and parsed by the web progress panel) so a re-encode or rename that silently
    // takes a playlist entry with it is visible instead of invisible.
    let mut favorites_dropped_total: u64 = 0;
    let mut playlists_dropped_total: u64 = 0;
    let scanned_folders: HashSet<String> = artist_folders.iter().cloned().collect();
    let mut mb_id_to_image_hash: HashMap<String, String> = HashMap::new();
    let mut all_artist_ids: HashSet<String> = HashSet::new();

    // -------------------------------------------------------------------------
    // Main folder loop
    // -------------------------------------------------------------------------
    for (folder_idx, folder_name) in artist_folders.iter().enumerate() {
        if shutdown.load(Ordering::SeqCst) {
            break;
        }

        if already_indexed.contains(folder_name.as_str()) {
            continue;
        }

        let folder_path = PathBuf::from(&music_dir).join(folder_name);

        reporter.item("", folder_name, folder_idx + 1, total_folders);

        // -----------------------------------------------------------------
        // Walk all audio files in this folder recursively
        // -----------------------------------------------------------------
        let walk_roots: Vec<PathBuf> = if let Some(ref tf) = target_folders {
            tf.get(folder_name)
                .map(|subs| {
                    subs.iter()
                        .map(|s| PathBuf::from(&music_dir).join(s))
                        .collect()
                })
                .unwrap_or_default()
        } else {
            vec![folder_path.clone()]
        };

        let paths: Vec<PathBuf> = walk_roots
            .iter()
            .flat_map(|root| {
                WalkDir::new(root)
                    .follow_links(true)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        if e.file_type().is_dir() {
                            return false;
                        }
                        e.path().extension().map_or(false, |ext| {
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
            if let Some(ref h) = run_hash {
                stamp_folder_index_hash(&pool, folder_name, h).await;
            }
            save_index_checkpoint(&pool, folder_name).await.ok();
            continue;
        }
        // -----------------------------------------------------------------
        // Load existing tracks for change detection
        // -----------------------------------------------------------------
        let folder_prefix = format!("{}/", folder_name);
        let existing_paths: HashSet<String> =
            if !args.overwrite && !args.inspect && args.folders.is_none() {
                let rows: Vec<(String,)> = sqlx::query_as(
                    r#"SELECT "filePath" FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
                )
                .bind(format!("{}%", escape_like(&folder_prefix)))
                .fetch_all(&pool)
                .await
                .unwrap_or_default();
                rows.into_iter().map(|(path,)| path).collect()
            } else {
                HashSet::new()
            };
        let existing_tracks: HashMap<String, (i64, NaiveDateTime, String)> = if args.inspect
            && args.folders.is_none()
        {
            let rows: Vec<(String, i64, Option<NaiveDateTime>, Option<String>)> = sqlx::query_as(
                r#"SELECT "filePath", "fileSize", mtime, "contentHash"
                   FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
            )
            .bind(format!("{}%", escape_like(&folder_prefix)))
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

        // Default mode: filter out already-indexed paths before extraction
        let paths: Vec<PathBuf> = if !existing_paths.is_empty() {
            let music_dir_prefix = format!("{}/", music_dir);
            paths
                .into_iter()
                .filter(|p| {
                    let rel = p
                        .to_string_lossy()
                        .strip_prefix(&music_dir_prefix)
                        .unwrap_or(&p.to_string_lossy())
                        .to_string();
                    !existing_paths.contains(&rel)
                })
                .collect()
        } else {
            paths
        };

        let file_count_after = paths.len();
        let pre_skipped = file_count - file_count_after;
        skipped_total += pre_skipped as u64;

        let mut folder_new: u64 = 0;
        let mut folder_updated: u64 = 0;
        let mut folder_skipped: u64 = 0;
        let mut folder_artist_ids: HashSet<String> = HashSet::new();
        let mut folder_releases: HashMap<String, String> = HashMap::new();

        if paths.is_empty() {
            reporter.step(&format!("{} files, all up to date", file_count));
        } else {
            if pre_skipped > 0 {
                reporter.step(&format!(
                    "Extracting metadata ({} new of {} files)...",
                    file_count_after, file_count
                ));
            } else {
                reporter.step(&format!("Extracting metadata ({} files)...", file_count));
            }
            total_files += file_count as u64;

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

            if !extracted.is_empty() {
                // -----------------------------------------------------------------
                // Pre-scan: propagate MB IDs within the same logical album
                // -----------------------------------------------------------------
                let mb_release_id_by_meta: HashMap<(String, i32, String), String> = {
                    let mut map: HashMap<(String, i32, String), String> = HashMap::new();
                    for track in &extracted {
                        if let Some(clean) = track
                            .mb_release_id
                            .as_deref()
                            .and_then(common::filters::sanitize_mb_id)
                        {
                            let key = (
                                track.album.as_deref().unwrap_or("").to_lowercase(),
                                track.year.unwrap_or(0),
                                track.album_artist.as_deref().unwrap_or("").to_lowercase(),
                            );
                            map.entry(key).or_insert(clean);
                        }
                    }
                    map
                };
                let mb_release_group_id_by_meta: HashMap<(String, i32, String), String> = {
                    let mut map: HashMap<(String, i32, String), String> = HashMap::new();
                    for track in &extracted {
                        if let Some(clean) = track
                            .mb_release_group_id
                            .as_deref()
                            .and_then(common::filters::sanitize_mb_id)
                        {
                            let key = (
                                track.album.as_deref().unwrap_or("").to_lowercase(),
                                track.year.unwrap_or(0),
                                track.album_artist.as_deref().unwrap_or("").to_lowercase(),
                            );
                            map.entry(key).or_insert(clean);
                        }
                    }
                    map
                };

                // Multi-disc folders -> one release, decided by tags alone (see plan_disc_merges).
                // Built before the track loop because the decision needs every folder's facts at
                // once, not one file's.
                let disc_merge_plan: HashMap<String, index::db::MergeTarget> = {
                    let mut by_folder: HashMap<String, (HashMap<String, usize>, BTreeSet<i32>)> =
                        HashMap::new();
                    for track in &extracted {
                        let raw = {
                            let parts: Vec<&str> = track.file_path.rsplitn(2, '/').collect();
                            if parts.len() > 1 {
                                parts[1].to_string()
                            } else {
                                String::new()
                            }
                        };
                        let entry = by_folder.entry(strip_disc_subfolder(&raw)).or_default();
                        if let Some(id) = track
                            .mb_release_id
                            .as_deref()
                            .and_then(common::filters::sanitize_mb_id)
                        {
                            *entry.0.entry(id).or_insert(0) += 1;
                        }
                        entry.1.insert(track.disc_number.unwrap_or(1));
                    }
                    let facts: Vec<index::db::FolderFacts> = by_folder
                        .into_iter()
                        .map(|(folder_path, (counts, disc_numbers))| index::db::FolderFacts {
                            folder_path,
                            majority_mb_release_id: counts
                                .into_iter()
                                .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
                                .map(|(id, _)| id),
                            disc_numbers,
                        })
                        .collect();
                    index::db::plan_disc_merges(&facts)
                };

                // Per-folder display title/year (mode album/year tag). The folder is the physical release
                // unit: every track in a folder shares one LocalRelease keyed by folder path (see
                // build_group_key), so the release's pre-match display name comes from the folder's majority
                // tag rather than whichever track happens to be processed last.
                let folder_display_meta: HashMap<String, (String, Option<i32>)> = {
                    let mut by_folder: HashMap<String, Vec<(Option<String>, Option<i32>)>> =
                        HashMap::new();
                    for track in &extracted {
                        let raw = {
                            let parts: Vec<&str> = track.file_path.rsplitn(2, '/').collect();
                            if parts.len() > 1 {
                                parts[1].to_string()
                            } else {
                                String::new()
                            }
                        };
                        // Key by the merged identity so a multi-disc release's display title/year
                        // is the majority across all its discs, not disc 1's alone.
                        let fp = strip_disc_subfolder(&raw);
                        let fp = disc_merge_plan
                            .get(&fp)
                            .map(|t| t.folder_path.clone())
                            .unwrap_or(fp);
                        by_folder
                            .entry(fp)
                            .or_default()
                            .push((track.album.clone(), track.year));
                    }
                    by_folder
                        .into_iter()
                        .map(|(fp, v)| (fp, folder_majority_title_year(&v)))
                        .collect()
                };

                // -----------------------------------------------------------------
                // Change detection + build batch
                // -----------------------------------------------------------------
                let mut mtime_updates: Vec<(NaiveDateTime, String)> = Vec::new();
                let mut batch_tracks: Vec<_> = Vec::new();
                let mut pending_release_artist_links: HashSet<(String, String)> = HashSet::new();
                // First album artist resolved for this folder - receives the folder image (see below).
                let mut folder_primary_artist_id: Option<String> = None;
                let mut release_mb_key: HashMap<String, String> = HashMap::new();
                let mut releases_with_art: HashSet<String> = HashSet::new();
                let mut releases_already_have_art: HashSet<String> = HashSet::new();
                let mut release_to_image_filename: HashMap<String, String> = HashMap::new();

                for track in &extracted {
                    if args.overwrite {
                        new_total += 1;
                        folder_new += 1;
                    } else if args.inspect {
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
                    } else if existing_paths.contains(&track.file_path) {
                        skipped_total += 1;
                        folder_skipped += 1;
                        continue;
                    } else {
                        new_total += 1;
                        folder_new += 1;
                    }

                    // The tag that names this release's owner(s) - albumArtist unless it is a
                    // Various-Artists placeholder, then the track's own artist tag. Shared with the
                    // resolve pass's owner reconcile (`index::resolve::owner_tag`) so the two can
                    // never disagree about which tag they are reconciling.
                    let owner_tag: Option<&str> = index::resolve::owner_tag(
                        track.album_artist.as_deref(),
                        track.artist.as_deref(),
                    )
                    .map(|t| t.value());

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
                    // MB ids are kept only for cover-art dedup (below), NOT for grouping - see build_group_key.
                    let sanitized_release_id = track
                        .mb_release_id
                        .as_deref()
                        .and_then(common::filters::sanitize_mb_id);
                    let sanitized_rg_id = track
                        .mb_release_group_id
                        .as_deref()
                        .and_then(common::filters::sanitize_mb_id);
                    let effective_release_id = sanitized_release_id
                        .as_deref()
                        .or_else(|| mb_release_id_by_meta.get(&meta_key).map(|s| s.as_str()));
                    let effective_rg_id = sanitized_rg_id.as_deref().or_else(|| {
                        mb_release_group_id_by_meta
                            .get(&meta_key)
                            .map(|s| s.as_str())
                    });

                    // A folder the tags place alongside its sibling discs lands on the shared,
                    // metadata-keyed release; everything else keeps the folder key it always had.
                    let merge_target = disc_merge_plan.get(&folder_path_str);
                    let group_key = match merge_target {
                        Some(t) => t.group_key.clone(),
                        None => build_group_key(
                            album_name,
                            track.year,
                            track.album_artist.as_deref().unwrap_or(""),
                            &folder_path_str,
                        ),
                    };
                    let display_key = merge_target
                        .map(|t| t.folder_path.as_str())
                        .unwrap_or(folder_path_str.as_str());

                    let (release_title, release_year) = folder_display_meta
                        .get(display_key)
                        .map(|(t, y)| (t.as_str(), *y))
                        .unwrap_or((album_name, track.year));

                    let release_result = match merge_target {
                        Some(t) => {
                            index::db::ensure_merged_local_release(
                                &pool,
                                release_title,
                                release_year,
                                t,
                                &mut release_cache,
                            )
                            .await
                        }
                        None => {
                            ensure_local_release_cached(
                                &pool,
                                release_title,
                                release_year,
                                &folder_path_str,
                                &group_key,
                                &mut release_cache,
                            )
                            .await
                        }
                    };
                    let release_id = match release_result {
                        Ok(id) => id,
                        Err(e) => {
                            reporter.err(&format!("DB error (release '{}'): {}", album_name, e));
                            error_total += 1;
                            continue;
                        }
                    };

                    folder_releases
                        .entry(release_id.clone())
                        .or_insert_with(|| display_key.to_string());

                    // Album-artist → release links (main artists)
                    match owner_tag {
                        None => {
                            // No albumArtist and no track artist at all - nothing to resolve.
                            if let Ok(aid) =
                                ensure_artist_cached(&pool, "Unknown Artist", &mut artist_cache)
                                    .await
                            {
                                if !aid.is_empty() {
                                    pending_release_artist_links
                                        .insert((release_id.clone(), aid.clone()));
                                    folder_artist_ids.insert(aid.clone());
                                }
                            }
                        }
                        Some(owner_tag) => {
                            let owners = index::resolve::resolve_owner_offline(owner_tag, |q| {
                                lookup_memo
                                    .get(q)
                                    .cloned()
                                    .unwrap_or(LookupResult::NeedsFetch)
                            });

                            for (owner_name, owner_mbid) in owners {
                                let Ok(aa_id) =
                                    ensure_artist_cached(&pool, &owner_name, &mut artist_cache)
                                        .await
                                else {
                                    continue;
                                };
                                if aa_id.is_empty() {
                                    continue;
                                }
                                if let Some(ref mbid) = owner_mbid {
                                    // Fill only when empty - never overwrite an id sync established.
                                    sqlx::query(
                                r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW()
                                   WHERE id = $2 AND ("musicbrainzId" IS NULL OR "musicbrainzId" = '')"#,
                            )
                            .bind(mbid)
                            .bind(&aa_id)
                            .execute(&pool)
                            .await
                            .ok();
                                }
                                pending_release_artist_links
                                    .insert((release_id.clone(), aa_id.clone()));
                                folder_artist_ids.insert(aa_id.clone());
                                // First resolved owner is the primary - it gets the folder image.
                                folder_primary_artist_id.get_or_insert(aa_id);
                            }
                        }
                    }

                    // Cover art: short-circuit if this MB release/release-group id already
                    // resolved to an image elsewhere in this run, else remember the key so
                    // the resolution pass below can populate the hash cache once it finds one.
                    if !args.skip_covers {
                        let mb_key = image_key_for_release(effective_release_id, effective_rg_id);
                        if let Some(ref mk) = mb_key {
                            if let Some(existing_filename) = mb_id_to_image_hash.get(mk) {
                                release_to_image_filename
                                    .insert(release_id.clone(), existing_filename.clone());
                                releases_already_have_art.insert(release_id.clone());
                            } else {
                                release_mb_key
                                    .entry(release_id.clone())
                                    .or_insert_with(|| mk.clone());
                            }
                        }
                    }

                    batch_tracks.push((track, release_id));
                }

                // -----------------------------------------------------------------
                // Flush mtime-only updates (--inspect mode)
                // -----------------------------------------------------------------
                if args.inspect {
                    batch_update_mtimes(&pool, &mtime_updates).await.ok();
                }

                // -----------------------------------------------------------------
                // Batch upsert tracks
                // -----------------------------------------------------------------
                if !batch_tracks.is_empty() {
                    if let Err(e) = batch_upsert_tracks(&pool, &batch_tracks).await {
                        reporter.err(&format!("Batch upsert error for '{}': {}", folder_name, e));
                        error_total += batch_tracks.len() as u64;
                    }
                }

                // Batch release-artist links
                if !pending_release_artist_links.is_empty() {
                    let links: Vec<(String, String)> =
                        pending_release_artist_links.into_iter().collect();
                    batch_ensure_local_release_artists(&pool, &links).await.ok();
                }

                // Print folder summary - verbose only when something actually changed
                {
                    if folder_new > 0 || folder_updated > 0 {
                        let mut parts = vec![format!("{} files", file_count)];
                        if folder_new > 0 {
                            parts.push(format!("{} new", folder_new));
                        }
                        if folder_updated > 0 {
                            parts.push(format!("{} updated", folder_updated));
                        }
                        if folder_skipped > 0 {
                            parts.push(format!("{} skipped", folder_skipped));
                        }
                        if folder_errors > 0 {
                            parts.push(format!("{} errors", folder_errors));
                        }
                        reporter.ok(&parts.join(", "));
                    } else if folder_errors > 0 {
                        reporter.warn(&format!("{} errors", folder_errors));
                    }
                }

                // -----------------------------------------------------------------
                // Cover art: external file (cover/folder/front, jpg/jpeg/png) first;
                // else the embedded picture tag of the release's first audio file
                // (root, or first disc subfolder's) - no scan past that first file.
                // -----------------------------------------------------------------
                if !args.skip_covers {
                    let art_targets: Vec<(String, String)> = folder_releases
                        .iter()
                        .filter(|(rid, _)| {
                            !releases_with_art.contains(*rid)
                                && (args.overwrite_with_images
                                    || !releases_already_have_art.contains(*rid))
                        })
                        .map(|(rid, fp)| (rid.clone(), fp.clone()))
                        .collect();

                    if !art_targets.is_empty() {
                        reporter.step(&format!(
                            "Extracting artwork ({} releases)...",
                            art_targets.len()
                        ));
                        let overwrite_images = args.overwrite_with_images;
                        let rid_clone = release_img_dir.clone();
                        let music_dir_clone = music_dir.clone();
                        let resolved_covers: Vec<(String, String, bool)> = art_targets
                            .par_iter()
                            .filter_map(|(release_id, rel_folder_path)| {
                                let abs_folder =
                                    PathBuf::from(&music_dir_clone).join(rel_folder_path);
                                let temp_path =
                                    rid_clone.join(format!("_tmp_{}.jpg", release_id));
                                if overwrite_images {
                                    std::fs::remove_file(&temp_path).ok();
                                }
                                if !resolve_release_cover(&abs_folder, &temp_path) {
                                    return None;
                                }
                                let hash = hash_image_file(&temp_path)?;
                                let final_name = format!("{}.jpg", hash);
                                let final_path = rid_clone.join(&final_name);
                                let newly_written = if final_path.exists() {
                                    std::fs::remove_file(&temp_path).ok();
                                    false
                                } else {
                                    std::fs::rename(&temp_path, &final_path).is_ok()
                                };
                                Some((release_id.clone(), hash, newly_written))
                            })
                            .collect();

                        for (release_id, hash, _) in &resolved_covers {
                            let filename = format!("{}.jpg", hash);
                            release_to_image_filename.insert(release_id.clone(), filename.clone());
                            if let Some(mk) = release_mb_key.get(release_id) {
                                mb_id_to_image_hash
                                    .entry(mk.clone())
                                    .or_insert_with(|| filename.clone());
                            }
                        }

                        if use_s3 {
                            if let (Some(ref client), Some(ref bucket), Some(ref public_url)) = (
                                &s3_client,
                                &config.storage_bucket,
                                &config.storage_public_url,
                            ) {
                                let mut uploaded_hashes: HashSet<String> = HashSet::new();
                                let mut uploads = FuturesUnordered::new();
                                for (release_id, hash, newly_written) in &resolved_covers {
                                    if !newly_written || !uploaded_hashes.insert(hash.clone()) {
                                        continue;
                                    }
                                    let client = client.clone();
                                    let bucket = bucket.clone();
                                    let public_url = public_url.clone();
                                    let pool2 = pool.clone();
                                    let rid = release_id.clone();
                                    let image_key = hash.clone();
                                    let p = release_img_dir.join(format!("{}.jpg", hash));
                                    uploads.push(async move {
                                        upload_release_image_to_s3(
                                            &client,
                                            &bucket,
                                            &public_url,
                                            &pool2,
                                            &rid,
                                            &image_key,
                                            &p,
                                        )
                                        .await;
                                        hash.clone()
                                    });
                                    if uploads.len() >= 8 {
                                        uploads.next().await;
                                    }
                                }
                                while uploads.next().await.is_some() {}
                            }
                        }

                        for (release_id, filename) in &release_to_image_filename {
                            let out_path = release_img_dir.join(filename);
                            if !out_path.exists() && !use_s3 {
                                continue;
                            }
                            if use_local {
                                sqlx::query(
                            r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                        )
                        .bind(filename)
                        .bind(release_id)
                        .execute(&pool)
                        .await
                        .ok();
                            }
                            if use_s3 {
                                if let Some(ref public_url) = config.storage_public_url {
                                    let image_url = format!(
                                        "{}/releases/{}",
                                        public_url.trim_end_matches('/'),
                                        filename
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
                            releases_with_art.insert(release_id.clone());
                        }
                    }
                }

                if !args.skip_covers {
                    // Artist folder image.
                    //
                    // The primary owner (first album artist resolved for this folder) always gets it; the other
                    // resolved owners only if they have no image yet. Previously this fired only for
                    // single-artist folders, which meant a folder like "Ella Fitzgerald & Roy Eldridge Sextet"
                    // handed its image to the compound junk artist - and once album artists split, such folders
                    // would have stopped contributing an image at all.
                    let image_targets: Vec<String> = match folder_primary_artist_id {
                        Some(ref primary) => std::iter::once(primary.clone())
                            .chain(
                                folder_artist_ids
                                    .iter()
                                    .filter(|id| *id != primary)
                                    .cloned(),
                            )
                            .collect(),
                        None => folder_artist_ids.iter().cloned().collect(),
                    };
                    for (position, artist_id) in image_targets.iter().enumerate() {
                        let is_primary = position == 0
                            && folder_primary_artist_id.as_deref() == Some(artist_id.as_str());

                        let existing_img: Option<(Option<String>, Option<String>)> =
                            sqlx::query_as(
                                r#"SELECT image, "imageUrl" FROM "Artist" WHERE id = $1"#,
                            )
                            .bind(artist_id)
                            .fetch_optional(&pool)
                            .await
                            .ok()
                            .flatten();

                        let needs_image = is_primary
                            || existing_img
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
                                        if let (
                                            Some(ref client),
                                            Some(ref bucket),
                                            Some(ref public_url),
                                        ) = (
                                            &s3_client,
                                            &config.storage_bucket,
                                            &config.storage_public_url,
                                        ) {
                                            let s3_key = format!("artists/{}.jpg", artist_slug);
                                            if upload_to_s3(client, bucket, &s3_key, &out_path)
                                                .await
                                                .is_ok()
                                            {
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

                if !args.skip_covers {
                    let newly_extracted = release_to_image_filename.len();
                    let mb_shortcut = releases_already_have_art
                        .iter()
                        .filter(|rid| release_to_image_filename.contains_key(*rid))
                        .count();
                    let hash_deduped = release_to_image_filename
                        .values()
                        .collect::<HashSet<_>>()
                        .len();
                    let pre_existing = releases_already_have_art.len() - mb_shortcut;

                    if newly_extracted > 0 || mb_shortcut > 0 {
                        let mut parts: Vec<String> = Vec::new();
                        if hash_deduped > 0 {
                            parts.push(format!("{} unique image(s)", hash_deduped));
                        }
                        if newly_extracted > hash_deduped {
                            parts.push(format!(
                                "{} reused via hash",
                                newly_extracted - hash_deduped
                            ));
                        }
                        if mb_shortcut > 0 {
                            parts.push(format!(
                                "{} skipped (same MB ID from previous extraction)",
                                mb_shortcut
                            ));
                        }
                        reporter.ok(&parts.join(", "));
                    }
                    if pre_existing > 0 {
                        reporter.ok(&format!("{} cover(s) already exist", pre_existing));
                    }
                }

                // Clean up temp images in S3-only mode
                if !use_local && use_s3 {
                    let mut cleaned: HashSet<String> = HashSet::new();
                    for filename in release_to_image_filename.values() {
                        if cleaned.insert(filename.clone()) {
                            let tmp = release_img_dir.join(filename);
                            std::fs::remove_file(&tmp).ok();
                        }
                    }
                }
            } // if !extracted.is_empty()
        } // if !paths.is_empty()

        // -----------------------------------------------------------------
        // Backfill: load folder_releases + folder_artist_ids from DB
        // -----------------------------------------------------------------
        {
            let db_releases: Vec<(String, String)> = sqlx::query_as(
                r#"SELECT DISTINCT lr.id, lr."folderPath"
                   FROM "LocalRelease" lr
                   WHERE lr."folderPath" LIKE $1"#,
            )
            // folder_prefix (not folder_name) - it already carries the trailing '/', otherwise this
            // is a prefix match with no boundary and "AC" would swallow "ACDC/...".
            .bind(format!("{}%", escape_like(&folder_prefix)))
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

        // -----------------------------------------------------------------
        // Delete tracks that no longer exist on disk
        // -----------------------------------------------------------------
        // --prune only counts when this pass actually walked the folder and found audio files in it:
        // that is what proves the mount is up, which is the only thing the ratio guard was defending.
        let prune = args.prune && file_count > 0;
        let deleted_tracks = if let Some(ref tf) = target_folders {
            let mut total = 0u64;
            for sub in tf.get(folder_name.as_str()).unwrap_or(&vec![]) {
                let prefix = format!("{}/", sub);
                let res = delete_removed_tracks(&pool, &prefix, &music_dir, prune).await;
                favorites_dropped_total += res.favorites_dropped;
                playlists_dropped_total += res.playlists_dropped;
                total += res.count;
            }
            total
        } else {
            let res = delete_removed_tracks(&pool, &folder_prefix, &music_dir, prune).await;
            favorites_dropped_total += res.favorites_dropped;
            playlists_dropped_total += res.playlists_dropped;
            res.count
        };

        // Cleanup used to run right here, once per folder - three full-table anti-joins × ~25k folders,
        // for a result nothing in this loop reads. It happens once after the loop instead.

        // -----------------------------------------------------------------
        // Update totals + lastIndexedAt
        // -----------------------------------------------------------------
        for aid in &folder_artist_ids {
            update_release_totals_for_artist(&pool, aid).await.ok();
            update_artist_totals_for_artist(&pool, aid).await.ok();
            propagate_mb_artist_id(&pool, aid).await.ok();
        }

        all_artist_ids.extend(folder_artist_ids.iter().cloned());
        let artist_ids_vec: Vec<String> = folder_artist_ids.into_iter().collect();
        if folder_new > 0 || folder_updated > 0 || deleted_tracks > 0 {
            update_last_indexed_at(&pool, &artist_ids_vec).await.ok();
        }

        // -----------------------------------------------------------------
        // Upsert FolderScan + save checkpoint + stamp run hash
        // -----------------------------------------------------------------
        if let Ok(meta) = std::fs::metadata(&folder_path) {
            if let Ok(sys_mtime) = meta.modified() {
                if let Ok(dur) = sys_mtime.duration_since(std::time::UNIX_EPOCH) {
                    if let Some(dt) = chrono::DateTime::from_timestamp(dur.as_secs() as i64, 0)
                        .map(|d| d.naive_utc())
                    {
                        upsert_folder_scan(&pool, folder_name, dt).await.ok();
                    }
                }
            }
        }
        if let Some(ref h) = run_hash {
            stamp_folder_index_hash(&pool, folder_name, h).await;
        }
        save_index_checkpoint(&pool, folder_name).await.ok();
        // update_statistics is 13 full-table aggregate scans - throttle to every 50 folders instead of
        // every single one (19K+ folders = 250K+ scans per full run otherwise). The guaranteed call
        // after the loop (below) always catches the tail, so stats are never more than 50 folders stale.
        if folder_idx % 50 == 0 {
            update_statistics(&pool).await.ok();
        }

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
        favorites_dropped_total += del.favorites_dropped;
        playlists_dropped_total += del.playlists_dropped;
        if del.tracks_deleted > 0 {
            reporter.info(&format!(
                "Removed {} track(s), {} release(s), {} artist(s) for deleted folders.",
                del.tracks_deleted, del.releases_deleted, del.artists_deleted
            ));
        }
    }

    // -------------------------------------------------------------------------
    // Post-loop: resolve artist identity + rebuild credit links
    // -------------------------------------------------------------------------
    if !shutdown.load(Ordering::SeqCst) && !args.skip_resolve {
        // A filtered run only resolves what it touched; an unfiltered run sweeps everything. This is
        // what keeps `./index --only "X"` from re-scanning all ~1.8M tracks every time.
        let scoped: Option<Vec<String>> = if has_filter(&args) {
            let ids: Vec<(String,)> = sqlx::query_as(
                r#"SELECT DISTINCT lra."localReleaseId" FROM "LocalReleaseArtist" lra
                   WHERE lra."artistId" = ANY($1::text[])"#,
            )
            .bind(&all_artist_ids.iter().cloned().collect::<Vec<String>>())
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
            Some(ids.into_iter().map(|(id,)| id).collect())
        } else {
            None
        };
        run_artist_resolution(&pool, &config, &reporter, false, scoped.as_deref(), false).await;
    }

    // -------------------------------------------------------------------------
    // Post-loop: re-extract missing release covers (safety net)
    // -------------------------------------------------------------------------
    if !shutdown.load(Ordering::SeqCst) && !args.skip_covers && !is_targeted {
        let has_filter = args.only.is_some() || args.from.is_some() || args.to.is_some();
        let missing: Vec<(String, String, Option<String>, String)> = if has_filter {
            let filtered_names: Vec<String> =
                sqlx::query_as::<_, (String,)>(r#"SELECT name FROM "Artist" ORDER BY name"#)
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .map(|(n,)| n)
                    .filter(|name| {
                        matches_filter(
                            name,
                            args.from.as_deref().unwrap_or(""),
                            args.to.as_deref().unwrap_or(""),
                            args.only.as_deref().unwrap_or(""),
                            args.exact,
                        )
                    })
                    .collect();
            if filtered_names.is_empty() {
                Vec::new()
            } else {
                sqlx::query_as(
                    r#"SELECT DISTINCT ON (lr.id) lr.id, lrt."filePath", lr."folderPath", lr."groupKey"
                       FROM "LocalRelease" lr
                       JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
                       JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
                       JOIN "Artist" a ON a.id = lra."artistId"
                       WHERE (lr.image IS NULL OR lr.image = '')
                         AND (lr."imageUrl" IS NULL OR lr."imageUrl" = '')
                         AND a.name = ANY($1)
                       ORDER BY lr.id, lrt."trackNumber" NULLS LAST, lrt."filePath""#,
                )
                .bind(&filtered_names)
                .fetch_all(&pool)
                .await
                .unwrap_or_default()
            }
        } else {
            sqlx::query_as(
                r#"SELECT DISTINCT ON (lr.id) lr.id, lrt."filePath", lr."folderPath", lr."groupKey"
                   FROM "LocalRelease" lr
                   JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
                   WHERE (lr.image IS NULL OR lr.image = '')
                     AND (lr."imageUrl" IS NULL OR lr."imageUrl" = '')
                   ORDER BY lr.id, lrt."trackNumber" NULLS LAST, lrt."filePath""#,
            )
            .fetch_all(&pool)
            .await
            .unwrap_or_default()
        };

        if !missing.is_empty() {
            reporter.step(&format!(
                "Re-checking {} release(s) with missing images...",
                missing.len()
            ));
            let mut fixed = 0u32;
            for (release_id, file_path, folder_path, group_key) in &missing {
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }

                if let Some(ref mk) = image_key_from_group_key(group_key) {
                    if let Some(existing_filename) = mb_id_to_image_hash.get(mk) {
                        let existing_path = release_img_dir.join(existing_filename);
                        if existing_path.exists() || use_s3 {
                            if use_local {
                                sqlx::query(
                                    r#"UPDATE "LocalRelease" SET image = $1, "updatedAt" = NOW() WHERE id = $2"#,
                                )
                                .bind(existing_filename)
                                .bind(release_id)
                                .execute(&pool)
                                .await
                                .ok();
                            }
                            if use_s3 {
                                if let Some(ref public_url) = config.storage_public_url {
                                    let image_url = format!(
                                        "{}/releases/{}",
                                        public_url.trim_end_matches('/'),
                                        existing_filename
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
                            fixed += 1;
                            continue;
                        }
                    }
                }

                let temp_path = release_img_dir.join(format!("_tmp_miss_{}.jpg", release_id));

                let effective_folder = folder_path
                    .as_deref()
                    .filter(|p| !p.is_empty())
                    .map(|p| PathBuf::from(&music_dir).join(p))
                    .or_else(|| {
                        PathBuf::from(&music_dir)
                            .join(file_path)
                            .parent()
                            .map(|p| p.to_path_buf())
                    });
                let got_image = effective_folder
                    .as_deref()
                    .map(|folder| resolve_release_cover(folder, &temp_path))
                    .unwrap_or(false);

                if got_image {
                    let filename = if let Some(hash) = hash_image_file(&temp_path) {
                        let name = format!("{}.jpg", hash);
                        let final_path = release_img_dir.join(&name);
                        if final_path.exists() {
                            std::fs::remove_file(&temp_path).ok();
                        } else {
                            std::fs::rename(&temp_path, &final_path).ok();
                        }
                        if let Some(ref mk) = image_key_from_group_key(group_key) {
                            mb_id_to_image_hash
                                .entry(mk.clone())
                                .or_insert_with(|| name.clone());
                        }
                        name
                    } else {
                        std::fs::remove_file(&temp_path).ok();
                        continue;
                    };

                    if use_s3 {
                        if let (Some(ref client), Some(ref bucket), Some(ref public_url)) = (
                            &s3_client,
                            &config.storage_bucket,
                            &config.storage_public_url,
                        ) {
                            let image_key = &filename[..filename.len() - 4]; // strip .jpg
                            upload_release_image_to_s3(
                                client,
                                bucket,
                                public_url,
                                &pool,
                                release_id,
                                image_key,
                                &release_img_dir.join(&filename),
                            )
                            .await;
                        }
                    }
                    if use_local {
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
                        std::fs::remove_file(&release_img_dir.join(&filename)).ok();
                    }
                    fixed += 1;
                } else {
                    std::fs::remove_file(&temp_path).ok();
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
        if error_total > 0 {
            parts.push(format!("{} errors", error_total));
        }
        reporter.info(&format!("  {}", parts.join(" | ")));
    }

    if favorites_dropped_total > 0 || playlists_dropped_total > 0 {
        reporter.info(&dropped_links_line(
            favorites_dropped_total,
            playlists_dropped_total,
        ));
    }

    // A filtered run cleans up only after the artists it actually touched. Sweeping globally from a
    // `--only "X"` run would let a one-artist rescan delete rows across the whole library - rows it has
    // no information about and did not create.
    let cleanup_scope: Option<Vec<String>> = has_filter(&args).then(|| {
        all_artist_ids
            .iter()
            .cloned()
            .collect::<Vec<String>>()
    });
    let rel_del = delete_empty_releases(&pool, &config, cleanup_scope.as_deref()).await;
    let mb_del = delete_orphaned_mb_releases(&pool, cleanup_scope.as_deref()).await;
    let art_del = delete_orphan_artists(&pool, &config, cleanup_scope.as_deref()).await;
    if rel_del > 0 || mb_del > 0 || art_del > 0 {
        reporter.info(&format!(
            "Cleanup{}: {} empty release(s), {} orphaned MB release(s), {} orphan artist(s).",
            if cleanup_scope.is_some() {
                " (this run's artists)"
            } else {
                ""
            },
            rel_del,
            mb_del,
            art_del
        ));
    }

    if let Some(ref path) = args.emit_artist_ids {
        let content = all_artist_ids
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        if let Err(e) = std::fs::write(path, content) {
            reporter.err(&format!("Failed to write artist IDs to {}: {}", path, e));
        }
    }

    clear_index_checkpoint(&pool).await.ok();
    update_statistics(&pool).await.ok();
    if run_hash.is_some() && !shutdown.load(Ordering::SeqCst) {
        clear_run_hash(&pool, "indexRunHash").await;
    }
    release_lock(&pool).await;
}
