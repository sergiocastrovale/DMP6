use chrono::Utc;
use clap::Parser;
use common::config::{apply_db_overrides, load_config};
use common::db::create_pool;
use common::filters::sanitize_mb_id;
use common::images::{download_artist_image, record_artist_image};
use common::lock::{acquire_lock, clear_stale_lock_minutes, release_lock};
use common::progress::Reporter;
use common::s3::create_s3_client;
use common::slug::make_slug;
use dmp_sync::catalogue_gaps;
use dmp_sync::mb_api::{self, RateLimiter};
use reqwest::Client;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

mod db;
mod folder;

/// Adds a MusicBrainz artist to the library before any files exist for them - an empty
/// `MUSIC_DIR` folder, an `Artist` row (`manuallyAdded = true`), and a catalogue-gaps pass so the
/// artist page shows its MISSING releases immediately. Web caller: `POST /add`'s Search.vue, via the
/// terminal toast/sidebar (docs/scripts/add.md). `./refresh` can't do this - it needs local files to
/// find an artist to sync, which a brand-new folder has none of, and plain `./sync` skips any artist
/// with no local releases outright.
#[derive(Parser, Debug)]
#[command(name = "add")]
struct AddArgs {
    #[arg(long, help = "MusicBrainz artist id (UUID)")]
    mbid: String,
    #[arg(
        long,
        help = "Set the new artist as monitored (download worker will fetch its catalogue)"
    )]
    monitored: bool,
    #[arg(long, help = "Print what would happen; no writes")]
    dry_run: bool,
    /// Emit PROGRESS:{json} lines and plain output for the web terminal.
    #[arg(long)]
    web: bool,
}

/// Exit codes: 0 = created, 1 = failure, 3 = artist already exists (mbid/slug/folder collision) - the
/// web caller (Search.vue) uses 3 specifically to show `Dialog.vue`'s error instead of a generic
/// failure toast.
const EXIT_ALREADY_EXISTS: i32 = 3;

#[tokio::main]
async fn main() {
    let args = AddArgs::parse();
    common::error_log::init("add");
    let reporter = Reporter::new(args.web);
    let mut config = load_config(None);
    let pool = create_pool(&config.database_url).await;
    apply_db_overrides(&mut config, &pool).await;

    reporter.header(if args.web {
        "DMP Add Artist"
    } else {
        "DMP Add Artist - New Library Entry"
    });

    let Some(mb_id) = sanitize_mb_id(&args.mbid) else {
        reporter.err(&format!("Not a valid MusicBrainz artist id: {}", args.mbid));
        std::process::exit(1);
    };

    let music_dir = match &config.music_dir {
        Some(d) if !d.is_empty() => d.clone(),
        _ => {
            reporter.err("MUSIC_DIR not configured - cannot create an artist folder");
            std::process::exit(1);
        }
    };

    if clear_stale_lock_minutes(&pool, 10).await {
        reporter.warn("Cleared stale scan lock.");
    }

    let pid = std::process::id();
    let lock_args = serde_json::json!({ "mbid": mb_id, "monitored": args.monitored });
    let _lock_guard = match acquire_lock(&pool, "add", pid, &lock_args.to_string()).await {
        Ok(g) => g,
        Err(e) => {
            reporter.err(&format!("Cannot start: {}", e));
            std::process::exit(1);
        }
    };

    let running = Arc::new(AtomicBool::new(true));
    {
        let running = running.clone();
        let pool2 = pool.clone();
        tokio::spawn(async move {
            tokio::signal::ctrl_c().await.ok();
            running.store(false, Ordering::SeqCst);
            eprintln!("\nShutdown requested - finishing current phase...");
            tokio::signal::ctrl_c().await.ok();
            release_lock(&pool2).await;
            std::process::exit(1);
        });
    }
    {
        let running = running.clone();
        let pool2 = pool.clone();
        tokio::spawn(async move {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler");
            term.recv().await;
            running.store(false, Ordering::SeqCst);
            release_lock(&pool2).await;
            std::process::exit(1);
        });
    }

    let http_client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("HTTP client");
    let mut limiter = RateLimiter::new();
    limiter.set_web(args.web);
    let s3_client = create_s3_client(&config).await;

    // One MB call: authoritative name + area + relations (image source), never trust a client-supplied
    // name (CLAUDE.md "Embedded MB IDs are definitive").
    let detail = match mb_api::mb_get_artist_detail(&http_client, &mb_id, &mut limiter).await {
        Ok(d) => d,
        Err(e) => {
            reporter.err(&format!("MusicBrainz lookup failed: {}", e));
            release_lock(&pool).await;
            std::process::exit(1);
        }
    };
    let name = detail.name.clone();
    let country = detail.country_code().map(|s| s.to_string());

    let slug = make_slug(&name);
    if slug.is_empty() {
        reporter.err(&format!(
            "Artist name sanitizes to an empty slug: {:?}",
            name
        ));
        release_lock(&pool).await;
        std::process::exit(1);
    }
    let Some(folder) = folder::folder_name(&name) else {
        reporter.err(&format!(
            "Artist name sanitizes to an empty folder name: {:?}",
            name
        ));
        release_lock(&pool).await;
        std::process::exit(1);
    };

    reporter.kv("Artist", &name);
    reporter.kv("Slug", &slug);
    reporter.kv("Folder", &folder);
    if let Some(ref c) = country {
        reporter.kv("Country", c);
    }
    reporter.kv("Monitored", if args.monitored { "yes" } else { "no" });
    reporter.blank();

    match db::find_existing_artist(&pool, &mb_id, &slug).await {
        Ok(Some(existing)) => {
            reporter.err(&format!(
                "Already in library: {} ({})",
                existing.name, existing.slug
            ));
            release_lock(&pool).await;
            std::process::exit(EXIT_ALREADY_EXISTS);
        }
        Ok(None) => {}
        Err(e) => {
            reporter.err(&format!("DB query failed: {}", e));
            release_lock(&pool).await;
            std::process::exit(1);
        }
    }

    let folder_path = Path::new(&music_dir).join(&folder);
    // Guard against the sanitized name still escaping MUSIC_DIR (e.g. "..") - folder_name only
    // replaces separators, it doesn't resolve `.`/`..` segments.
    match folder_path.parent() {
        Some(p) if p == Path::new(&music_dir) => {}
        _ => {
            reporter.err(&format!(
                "Refusing unsafe folder path: {}",
                folder_path.display()
            ));
            release_lock(&pool).await;
            std::process::exit(1);
        }
    }
    if folder_path.exists() {
        reporter.err(&format!("Folder already exists: {}", folder_path.display()));
        release_lock(&pool).await;
        std::process::exit(EXIT_ALREADY_EXISTS);
    }

    if args.dry_run {
        reporter.done("Dry run - nothing created.");
        release_lock(&pool).await;
        return;
    }

    if let Err(e) = std::fs::create_dir(&folder_path) {
        let code = if e.kind() == std::io::ErrorKind::AlreadyExists {
            EXIT_ALREADY_EXISTS
        } else {
            1
        };
        reporter.err(&format!("Could not create folder: {}", e));
        release_lock(&pool).await;
        std::process::exit(code);
    }

    let artist_id = cuid2::create_id();
    if let Err(e) = db::insert_artist(
        &pool,
        &artist_id,
        &name,
        &slug,
        &mb_id,
        country.as_deref(),
        args.monitored,
    )
    .await
    {
        std::fs::remove_dir(&folder_path).ok();
        let code = if e
            .as_database_error()
            .map(|d| d.is_unique_violation())
            .unwrap_or(false)
        {
            EXIT_ALREADY_EXISTS
        } else {
            1
        };
        reporter.err(&format!("Could not create artist: {}", e));
        release_lock(&pool).await;
        std::process::exit(code);
    }

    reporter.ok(&format!("Created artist folder + DB row for {}", name));

    match download_artist_image(&http_client, &detail, &slug, None, &s3_client, &config).await {
        Ok(true) => {
            record_artist_image(&pool, &config, &artist_id, &slug).await;
            reporter.sub_ok("Artist image downloaded");
        }
        Ok(false) => reporter.sub_step("Artist image not found"),
        Err(e) => reporter.sub_step(&format!("Artist image error: {}", e)),
    }

    reporter.blank();
    let artist_ids = vec![artist_id.clone()];
    match catalogue_gaps::fill_catalogue_gaps(
        &pool,
        &http_client,
        &mut limiter,
        &reporter,
        &running,
        None,
        None,
        None,
        false,
        false,
        args.web,
        Some(&artist_ids),
    )
    .await
    {
        Ok((_, gaps, processed)) => {
            catalogue_gaps::finish_run(&pool, Some(&processed), &reporter).await;
            sqlx::query(r#"UPDATE "Artist" SET "lastGapsCheckedAt" = $1 WHERE id = $2"#)
                .bind(Utc::now().naive_utc())
                .bind(&artist_id)
                .execute(&pool)
                .await
                .ok();
            reporter.blank();
            reporter.done(&format!(
                "Added {} - {} release(s) in catalogue",
                name, gaps
            ));
            release_lock(&pool).await;
        }
        Err(e) => {
            // Artist + folder already exist and are valid - a failed catalogue fetch is retried by the
            // artist page's own sync, not rolled back here.
            reporter.warn(&format!(
                "Catalogue fetch failed: {} (artist was still created)",
                e
            ));
            release_lock(&pool).await;
            std::process::exit(1);
        }
    }
}
