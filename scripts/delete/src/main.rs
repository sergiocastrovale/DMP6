use clap::{ArgGroup, Parser};
use common::{
    config::{apply_db_overrides, load_config, Config},
    error_log,
    lock::{acquire_lock, clear_stale_lock_minutes, release_lock},
    progress::Reporter,
    statistics::update_statistics,
};
use delete::artist::{build_plan, execute_plan, DeletionPlan};
use sqlx::postgres::PgPoolOptions;
use std::io;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(
    name = "delete",
    about = "Permanently delete an artist's catalogue, or a single release from it. If the \
             artist is credited on other artists' tracks, those credits are removed too - \
             warned before confirming.",
    group(ArgGroup::new("target").required(true).args(["artist", "release"]))
)]
struct Args {
    /// Artist name(s), separated by ';' for multiple (case-insensitive exact match)
    artist: Option<String>,

    /// Delete a single release (LocalRelease id) instead of a whole artist - the rest of the
    /// artist's catalogue is left untouched.
    #[arg(long)]
    release: Option<String>,

    /// Skip confirmation prompt
    #[arg(long)]
    y: bool,

    /// Also delete the audio files from disk (only paths inside MUSIC_DIR)
    #[arg(long)]
    files: bool,

    /// Show what would be deleted without changing anything
    #[arg(long)]
    dry_run: bool,
}

// ---------------------------------------------------------------------------
// Files on disk
// ---------------------------------------------------------------------------

/// Deletes the artist's audio files and prunes the folders they emptied. Runs AFTER the DB work: a
/// failed transaction must never leave the catalogue intact while the files are gone. Paths outside
/// MUSIC_DIR are skipped and reported, never followed (see `delete::files`).
fn remove_audio_files(plan: &DeletionPlan, config: &Config, dry_run: bool, reporter: &Reporter) {
    let Some(music_dir) = config.music_dir.as_deref() else {
        reporter.warn("MUSIC_DIR is not configured - no files deleted");
        error_log::log_error("--files requested but MUSIC_DIR is not configured");
        return;
    };

    let result = delete::files::delete_files(&plan.track_paths, music_dir, dry_run);
    let verb = if dry_run { "would remove" } else { "removed" };

    reporter.nested().ok(&format!(
        "{} {} file(s), {} empty folder(s)",
        verb, result.files_removed, result.dirs_removed
    ));

    if !result.skipped.is_empty() {
        reporter.nested().warn(&format!(
            "{} path(s) skipped (outside MUSIC_DIR, missing, or not removable)",
            result.skipped.len()
        ));
        for path in result.skipped.iter().take(10) {
            reporter.nested().nested().info(path);
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let args = Args::parse();
    error_log::init("delete");
    let reporter = Reporter::new(false);

    reporter.header("DMP Delete");
    if args.dry_run {
        reporter.kv("Mode", "dry run");
    }

    let mut config = load_config(None);

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database. Is PostgreSQL running?");

    // DB-configured S3/image settings (Settings table) override env, same as index/sync - without
    // this, delete never sees S3 credentials that live only in Settings and silently skips deleting
    // the artist's images from S3.
    apply_db_overrides(&mut config, &pool).await;

    if let Some(release_id) = &args.release {
        delete::release::run(
            &pool,
            &config,
            release_id,
            args.y,
            args.files,
            args.dry_run,
            &reporter,
        )
        .await;
        return;
    }

    // Reachable only in artist mode - the clap ArgGroup guarantees exactly one of `artist`/`release`.
    let artist_names: Vec<String> = args
        .artist
        .as_deref()
        .unwrap_or_default()
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if artist_names.len() == 1 {
        reporter.kv("Target", &artist_names[0]);
    } else {
        reporter.kv("Targets", &format!("{} artists", artist_names.len()));
        for name in &artist_names {
            reporter.nested().info(name);
        }
    }
    reporter.blank();

    // Resolve target artists
    let mut target_ids: Vec<(String, String)> = Vec::new();
    for name in &artist_names {
        let matches: Vec<(String, String, String)> = sqlx::query_as(
            r#"SELECT id, name, slug FROM "Artist" WHERE LOWER(name) = LOWER($1) ORDER BY name ASC"#,
        )
        .bind(name)
        .fetch_all(&pool)
        .await
        .expect("Failed to query Artist table");

        match matches.len() {
            0 => {
                error_log::log_error(&format!("No artist found matching '{}'", name));
                reporter.failed(&format!("No artist found matching '{}'", name));
                std::process::exit(1);
            }
            1 => {
                target_ids.push((matches[0].0.clone(), matches[0].1.clone()));
            }
            n => {
                error_log::log_error(&format!("{} artists match '{}' - ambiguous", n, name));
                reporter.err(&format!("{} artists match '{}':", n, name));
                for (_id, name, slug) in &matches {
                    reporter.nested().info(&format!("{} ({})", name, slug));
                }
                reporter.failed("Refine the name and try again.");
                std::process::exit(1);
            }
        }
    }

    // Expand targets: include connected (linked) artists
    let mut connected_ids: Vec<(String, String)> = Vec::new();
    for (tid, _) in &target_ids {
        let rows: Vec<(String, String)> =
            sqlx::query_as(r#"SELECT id, name FROM "Artist" WHERE "primaryArtistId" = $1"#)
                .bind(tid)
                .fetch_all(&pool)
                .await
                .expect("Failed to query connected artists");
        for (id, name) in rows {
            connected_ids.push((id, name));
        }
    }
    if !connected_ids.is_empty() {
        reporter.kv(
            "Linked artists",
            &format!("{} (will be deleted with primary)", connected_ids.len()),
        );
        for (_, name) in &connected_ids {
            reporter.nested().info(name);
        }
        reporter.blank();
        target_ids.extend(connected_ids);
    }

    let plan = build_plan(&pool, &target_ids)
        .await
        .expect("Failed to build deletion plan");

    // Display plan
    reporter.section("Plan");

    if !plan.artist_actions.is_empty() {
        reporter.kv("Artists to delete", &plan.artist_actions.len().to_string());
        for a in &plan.artist_actions {
            let tag = if a.is_cascaded { "cascaded" } else { "target" };
            let warning = if a.other_credits_count > 0 {
                format!(
                    " - KEPT as credit-only artist: still credited on {} track(s) by other artists",
                    a.other_credits_count
                )
            } else {
                String::new()
            };
            reporter
                .nested()
                .info(&format!("{} ({}) {}{}", a.name, a.slug, tag, warning));
        }
    }

    reporter.kv("Local releases", &plan.doomed_releases.len().to_string());
    let co_owned = plan.owned_releases.len() - plan.doomed_releases.len();
    if co_owned > 0 {
        reporter.kv(
            "Co-owned kept",
            &format!(
                "{} (still owned by another artist - only unlinked)",
                co_owned
            ),
        );
    }
    reporter.kv("Local tracks", &plan.track_count.to_string());
    reporter.kv(
        "MB releases",
        &format!(
            "{} (unlinked; removed when nothing else uses them)",
            plan.mb_releases.len()
        ),
    );
    if args.files {
        reporter.kv(
            "Files on disk",
            &format!(
                "{} (will be DELETED from MUSIC_DIR)",
                plan.track_paths.len()
            ),
        );
    }
    reporter.blank();

    if plan.artist_actions.is_empty() {
        reporter.done("Nothing to do.");
        return;
    }

    if args.dry_run {
        if args.files {
            remove_audio_files(&plan, &config, true, &reporter);
        }
        reporter.done("Dry run - no changes made.");
        return;
    }

    // Confirm
    if !args.y {
        reporter.prompt("Type y to confirm: ");
        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        if input.trim().to_lowercase() != "y" {
            reporter.done("Aborted.");
            std::process::exit(0);
        }
        reporter.blank();
    }

    // Same DB scan lock index/sync use - acquired only now (not while waiting on the confirmation
    // prompt above) so delete's cascading writes never interleave with a running index/sync pass.
    if clear_stale_lock_minutes(&pool, common::lock::STALE_LOCK_MINUTES).await {
        reporter.warn("Cleared a stale lock.");
    }
    let _lock_guard = match acquire_lock(&pool, "delete", std::process::id()).await {
        Ok(g) => g,
        Err(e) => {
            reporter.failed(&format!("Cannot start: {}", e));
            std::process::exit(1);
        }
    };

    reporter.step("Deleting...");
    match execute_plan(&pool, &plan, &config, false).await {
        Ok((local, s3)) => {
            reporter.nested().ok(&format!(
                "{} local image(s), {} S3 object(s) removed",
                local, s3
            ));
        }
        Err(e) => {
            error_log::log_error(&format!("Database error: {}", e));
            reporter.failed(&format!("Database error: {}", e));
            release_lock(&pool, "delete", std::process::id()).await;
            std::process::exit(1);
        }
    }

    if args.files {
        remove_audio_files(&plan, &config, false, &reporter);
    }

    update_statistics(&pool).await.ok();
    release_lock(&pool, "delete", std::process::id()).await;

    reporter.blank();
    let kept = plan
        .artist_actions
        .iter()
        .filter(|a| a.other_credits_count > 0)
        .count();
    reporter.done(&format!(
        "{} artist(s) deleted, {} kept as credit-only. {} local release(s), {} MB release(s) deleted.",
        plan.artist_actions.len() - kept,
        kept,
        plan.doomed_releases.len(),
        plan.mb_releases.len()
    ));
}
