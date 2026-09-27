use chrono::Utc;
use clap::Parser;
use common::config::{apply_db_overrides, load_config};
use common::db::create_pool_or_exit;
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

mod db;
mod folder;
mod homonym;

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
    /// Log skipped/already-covered release groups during the catalogue-gaps pass.
    #[arg(long)]
    verbose: bool,
    /// Emit PROGRESS:{json} lines and plain output for the web terminal.
    #[arg(long)]
    web: bool,
}

/// Exit codes: 0 = created (or linked to an existing unidentified artist of that name), 1 = failure, 3 = this
/// MusicBrainz artist is already in the library (another artist with the same name is not a collision) - the
/// web caller (Search.vue) uses 3 specifically to show `Dialog.vue`'s error instead of a generic
/// failure toast.
const EXIT_ALREADY_EXISTS: i32 = 3;

#[tokio::main]
async fn main() {
    let args = AddArgs::parse();
    common::error_log::init("add");
    let reporter = Reporter::new(args.web);
    let mut config = load_config(None);
    let pool = create_pool_or_exit(&config.database_url, "add").await;
    apply_db_overrides(&mut config, &pool).await;

    reporter.header("DMP Add Artist");

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

    if clear_stale_lock_minutes(&pool, common::lock::STALE_LOCK_MINUTES).await {
        reporter.warn("Cleared stale scan lock.");
    }

    let pid = std::process::id();
    let _lock_guard = match acquire_lock(&pool, "add", pid).await {
        Ok(g) => g,
        Err(e) => {
            reporter.err(&format!("Cannot start: {}", e));
            std::process::exit(1);
        }
    };

    let running = common::app::spawn_shutdown_handlers(&pool, "add", "phase", 1);

    let http_client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("HTTP client");
    let mut limiter = RateLimiter::new();
    let s3_client = create_s3_client(&config).await;

    // One MB call: authoritative name + area + relations (image source), never trust a client-supplied
    // name (CLAUDE.md "Embedded MB IDs are definitive").
    let detail = match mb_api::mb_get_artist_detail(&http_client, &mb_id, &mut limiter).await {
        Ok(d) => d,
        Err(e) => {
            reporter.err(&format!("MusicBrainz lookup failed: {}", e));
            release_lock(&pool, "add", std::process::id()).await;
            std::process::exit(1);
        }
    };
    let name = detail.name.clone();
    let country = detail.country_code().map(|s| s.to_string());

    let base_slug = make_slug(&name);
    if base_slug.is_empty() {
        reporter.err(&format!(
            "Artist name sanitizes to an empty slug: {:?}",
            name
        ));
        release_lock(&pool, "add", std::process::id()).await;
        std::process::exit(1);
    }
    let Some(name_folder) = folder::folder_name(&name) else {
        reporter.err(&format!(
            "Artist name sanitizes to an empty folder name: {:?}",
            name
        ));
        release_lock(&pool, "add", std::process::id()).await;
        std::process::exit(1);
    };

    match db::find_existing_artist(&pool, &mb_id).await {
        Ok(Some(existing)) => {
            reporter.err(&format!(
                "Already in library: {} ({})",
                existing.name, existing.slug
            ));
            release_lock(&pool, "add", std::process::id()).await;
            std::process::exit(EXIT_ALREADY_EXISTS);
        }
        Ok(None) => {}
        Err(e) => {
            reporter.err(&format!("DB query failed: {}", e));
            release_lock(&pool, "add", std::process::id()).await;
            std::process::exit(1);
        }
    }

    // Artists already under this name are other artists (a different id) - unless the one that was never identified
    // is this one. Its own albums decide, the same way sync decides (docs/sync_decisions.md "Two artists, one name").
    let members = match db::members(&pool, &base_slug).await {
        Ok(m) => m,
        Err(e) => {
            reporter.err(&format!("DB query failed: {}", e));
            release_lock(&pool, "add", std::process::id()).await;
            std::process::exit(1);
        }
    };
    let identified: Option<Option<String>> = match members.iter().find(|m| m.mbid.is_none()) {
        None => None,
        Some(u) => {
            reporter.step(&format!(
                "Checking whether the {} already in the library is this artist...",
                name
            ));
            let mut candidates =
                mb_api::mb_search_artist_exact_all(&http_client, &name, &mut limiter)
                    .await
                    .unwrap_or_default();
            if !candidates.iter().any(|c| c.id == mb_id) {
                candidates.push(
                    mb_api::mb_lookup_artist(&http_client, &mb_id, &mut limiter)
                        .await
                        .unwrap_or(dmp_sync::mb_types::MbArtistMatch {
                            id: mb_id.clone(),
                            name: name.clone(),
                            score: Some(100),
                            aliases: None,
                        }),
                );
            }
            match dmp_sync::mb_matching::choose_homonym(
                &http_client,
                &pool,
                &u.id,
                &candidates,
                &mut limiter,
            )
            .await
            {
                Ok(pick) => Some(pick.map(|m| m.id)),
                Err(e) => {
                    reporter.warn(&format!("Could not check the existing artist: {}", e));
                    Some(None)
                }
            }
        }
    };
    let decision = homonym::decide(&members, identified, &mb_id);

    if let homonym::AddDecision::LinkExisting { artist_id } = &decision {
        reporter.ok(&format!(
            "Your existing {} is this artist - linking it instead of adding a second one",
            name
        ));
        if args.dry_run {
            reporter.done("Dry run - nothing changed.");
            release_lock(&pool, "add", std::process::id()).await;
            return;
        }
        let linked = sqlx::query(
            r#"UPDATE "Artist" SET "musicbrainzId" = $1, country = COALESCE(country, $2), monitored = monitored OR $3,
                   "updatedAt" = NOW() WHERE id = $4"#,
        )
        .bind(&mb_id)
        .bind(country.as_deref())
        .bind(args.monitored)
        .bind(artist_id)
        .execute(&pool)
        .await;
        if let Err(e) = linked {
            reporter.err(&format!("Could not link the existing artist: {}", e));
            release_lock(&pool, "add", std::process::id()).await;
            std::process::exit(1);
        }
        if let Err(e) = common::homonyms::reconcile_group(&pool, &base_slug).await {
            reporter.warn(&format!("Homonym reconcile failed: {}", e));
        }
        run_gaps(
            &pool,
            &http_client,
            &mut limiter,
            &reporter,
            &running,
            artist_id,
            &name,
            args.verbose,
        )
        .await;
        return;
    }
    if let homonym::AddDecision::Create {
        identify: Some((unidentified, its_id)),
    } = &decision
    {
        reporter.nested().info(&format!(
            "The {} already in the library is another artist ({}) - keeping both",
            name, its_id
        ));
        if !args.dry_run {
            sqlx::query(
                r#"UPDATE "Artist" SET "musicbrainzId" = $1, "updatedAt" = NOW() WHERE id = $2"#,
            )
            .bind(its_id)
            .bind(unidentified)
            .execute(&pool)
            .await
            .ok();
        }
    } else if !members.is_empty() {
        reporter.nested().info(&format!(
            "Another artist named {} is already in the library - both keep their own page",
            name
        ));
    }

    // A shared name: the folder carries the same id token as the slug so the two never share a directory.
    let bare_folder_taken = Path::new(&music_dir).join(&name_folder).exists();
    let folder = homonym::folder_for(&name_folder, &mb_id, bare_folder_taken);

    reporter.kv("Artist", &name);
    reporter.kv("Folder", &folder);
    if let Some(ref c) = country {
        reporter.kv("Country", c);
    }
    reporter.kv("Monitored", if args.monitored { "yes" } else { "no" });
    reporter.blank();

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
            release_lock(&pool, "add", std::process::id()).await;
            std::process::exit(1);
        }
    }
    if folder_path.exists() {
        reporter.err(&format!("Folder already exists: {}", folder_path.display()));
        release_lock(&pool, "add", std::process::id()).await;
        std::process::exit(EXIT_ALREADY_EXISTS);
    }

    if args.dry_run {
        reporter.done("Dry run - nothing created.");
        release_lock(&pool, "add", std::process::id()).await;
        return;
    }

    if let Err(e) = std::fs::create_dir(&folder_path) {
        let code = if e.kind() == std::io::ErrorKind::AlreadyExists {
            EXIT_ALREADY_EXISTS
        } else {
            1
        };
        reporter.err(&format!("Could not create folder: {}", e));
        release_lock(&pool, "add", std::process::id()).await;
        std::process::exit(code);
    }

    let artist_id = cuid2::create_id();
    // Alone under its name it takes the bare slug; otherwise a provisional one that the reconcile below replaces with
    // the group's id-suffixed form (and moves the existing members off the bare slug).
    let provisional_slug = if members.is_empty() {
        base_slug.clone()
    } else {
        format!("__homonym-{}", artist_id)
    };
    if let Err(e) = db::insert_artist(
        &pool,
        &artist_id,
        &name,
        &provisional_slug,
        &base_slug,
        &mb_id,
        country.as_deref(),
        detail.disambiguation.as_deref(),
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
        release_lock(&pool, "add", std::process::id()).await;
        std::process::exit(code);
    }
    match common::homonyms::reconcile_group(&pool, &base_slug).await {
        Ok(outcome) => {
            for (_, old, new) in outcome.renamed.iter().filter(|(id, _, _)| *id != artist_id) {
                reporter.nested().ok(&format!(
                    "Artist page moved: /artist/{old} -> /artist/{new}"
                ));
            }
        }
        Err(e) => reporter.warn(&format!("Homonym reconcile failed: {}", e)),
    }
    let slug: String = sqlx::query_scalar(r#"SELECT slug FROM "Artist" WHERE id = $1"#)
        .bind(&artist_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(provisional_slug);
    reporter.kv("Page", &format!("/artist/{}", slug));

    reporter.ok(&format!("Created artist folder + DB row for {}", name));

    match download_artist_image(&http_client, &detail, &slug, None, &s3_client, &config).await {
        Ok(true) => {
            record_artist_image(&pool, &config, &artist_id, &slug).await;
            reporter.nested().ok("Artist image downloaded");
        }
        Ok(false) => reporter.nested().skip("Artist image not found"),
        Err(e) => reporter
            .nested()
            .warn(&format!("Artist image error: {}", e)),
    }

    reporter.blank();
    run_gaps(
        &pool,
        &http_client,
        &mut limiter,
        &reporter,
        &running,
        &artist_id,
        &name,
        args.verbose,
    )
    .await;
}

/// The catalogue-gaps pass for one artist, so its page shows its MISSING releases immediately. Exits non-zero when
/// the catalogue could not be fetched (the artist itself is kept either way).
#[allow(clippy::too_many_arguments)]
async fn run_gaps(
    pool: &sqlx::PgPool,
    http_client: &Client,
    limiter: &mut RateLimiter,
    reporter: &Reporter,
    running: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    artist_id: &str,
    name: &str,
    verbose: bool,
) {
    let artist_ids = vec![artist_id.to_string()];
    match catalogue_gaps::fill_catalogue_gaps(
        catalogue_gaps::GapFillContext {
            pool,
            http_client,
            limiter,
            reporter,
            running,
        },
        catalogue_gaps::ArtistFilter {
            from: None,
            to: None,
            only: None,
            exact: false,
        },
        false,
        verbose,
        Some(&artist_ids),
    )
    .await
    {
        // `processed` only ever gains this id once the whole per-artist body ran without hitting one
        // of the loop's own `continue`s (an MB fetch failure, an unreadable owned-group set) - a
        // single-artist call skipping the only artist in scope is indistinguishable from a real
        // failure, so this must not be treated as success just because the call returned `Ok`.
        Ok((_, gaps, processed)) if processed.iter().any(|p| p == artist_id) => {
            catalogue_gaps::finish_run(pool, Some(&processed), reporter).await;
            sqlx::query(r#"UPDATE "Artist" SET "lastGapsCheckedAt" = $1 WHERE id = $2"#)
                .bind(Utc::now().naive_utc())
                .bind(artist_id)
                .execute(pool)
                .await
                .ok();
            reporter.blank();
            reporter.done(&format!(
                "Added {} - {} release(s) in catalogue",
                name, gaps
            ));
            release_lock(pool, "add", std::process::id()).await;
        }
        Ok(_) => {
            reporter.warn(&format!(
                "Catalogue fetch failed for {} (artist was still created)",
                name
            ));
            release_lock(pool, "add", std::process::id()).await;
            std::process::exit(1);
        }
        Err(e) => {
            // Artist + folder already exist and are valid - a failed catalogue fetch is retried by the
            // artist page's own sync, not rolled back here.
            reporter.warn(&format!(
                "Catalogue fetch failed: {} (artist was still created)",
                e
            ));
            release_lock(pool, "add", std::process::id()).await;
            std::process::exit(1);
        }
    }
}
