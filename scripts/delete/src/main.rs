use clap::{ArgGroup, Parser};
use colored::*;
use common::{
    config::{apply_db_overrides, load_config, Config},
    error_log,
    lock::{acquire_lock, clear_stale_lock_minutes, release_lock},
    statistics::update_statistics,
};
use delete::artist::{build_plan, execute_plan, DeletionPlan};
use sqlx::postgres::PgPoolOptions;
use std::io::{self, Write};

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
fn remove_audio_files(plan: &DeletionPlan, config: &Config, dry_run: bool) {
    let Some(music_dir) = config.music_dir.as_deref() else {
        eprintln!(
            "  {} MUSIC_DIR is not configured - no files deleted",
            "✗".red()
        );
        error_log::log_error("--files requested but MUSIC_DIR is not configured");
        return;
    };

    let result = delete::files::delete_files(&plan.track_paths, music_dir, dry_run);
    let verb = if dry_run { "would remove" } else { "removed" };

    println!(
        "  {} {} {} file(s), {} empty folder(s)",
        "✓".green(),
        verb,
        result.files_removed,
        result.dirs_removed
    );

    if !result.skipped.is_empty() {
        println!(
            "  {} {} path(s) skipped (outside MUSIC_DIR, missing, or not removable)",
            "!".yellow(),
            result.skipped.len()
        );
        for path in result.skipped.iter().take(10) {
            println!("      {} {}", "•".bright_black(), path.bright_black());
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

    println!("{}", "DMP Delete".bright_cyan().bold());
    println!("{}", "==========".bright_black());
    if args.dry_run {
        println!(
            "Mode    : {}",
            "DRY RUN (no changes will be made)".yellow().bold()
        );
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
        delete::release::run(&pool, &config, release_id, args.y, args.files, args.dry_run).await;
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
        println!("Target  : {}", artist_names[0].bright_white());
    } else {
        println!(
            "Targets : {} artists",
            artist_names.len().to_string().bright_white()
        );
        for name in &artist_names {
            println!("    {} {}", "•".bright_black(), name.bright_white());
        }
    }
    println!();

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
                eprintln!("{} No artist found matching '{}'", "✗".red(), name);
                std::process::exit(1);
            }
            1 => {
                target_ids.push((matches[0].0.clone(), matches[0].1.clone()));
            }
            n => {
                error_log::log_error(&format!("{} artists match '{}' - ambiguous", n, name));
                eprintln!("{} {} artists match '{}':", "✗".red(), n, name);
                for (_id, name, slug) in &matches {
                    eprintln!("    - {} ({})", name, slug.bright_black());
                }
                eprintln!("Refine the name and try again.");
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
        println!(
            "Linked artists : {} (will be deleted with primary)",
            connected_ids.len().to_string().bright_white()
        );
        for (_, name) in &connected_ids {
            println!("    {} {}", "•".bright_black(), name.bright_white());
        }
        println!();
        target_ids.extend(connected_ids);
    }

    let plan = build_plan(&pool, &target_ids)
        .await
        .expect("Failed to build deletion plan");

    // Display plan
    println!("{}", "Plan".bright_cyan().bold());
    println!("{}", "----".bright_black());

    if !plan.artist_actions.is_empty() {
        println!(
            "Artists to delete: {}",
            plan.artist_actions.len().to_string().bright_white()
        );
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
            println!(
                "    {} {}  {}",
                "•".bright_black(),
                a.name.bright_white(),
                format!("({}) {}{}", a.slug, tag, warning).bright_black()
            );
        }
    }

    println!(
        "Local releases  : {}",
        plan.doomed_releases.len().to_string().bright_white()
    );
    let co_owned = plan.owned_releases.len() - plan.doomed_releases.len();
    if co_owned > 0 {
        println!(
            "Co-owned kept   : {} {}",
            co_owned.to_string().bright_white(),
            "(still owned by another artist - only unlinked)".bright_black()
        );
    }
    println!(
        "Local tracks    : {}",
        plan.track_count.to_string().bright_white()
    );
    println!(
        "MB releases     : {} {}",
        plan.mb_releases.len().to_string().bright_white(),
        "(unlinked; removed when nothing else uses them)".bright_black()
    );
    if args.files {
        println!(
            "Files on disk   : {} {}",
            plan.track_paths.len().to_string().bright_white(),
            "(will be DELETED from MUSIC_DIR)".red().bold()
        );
    }
    println!();

    if plan.artist_actions.is_empty() {
        println!("Nothing to do.");
        return;
    }

    if args.dry_run {
        if args.files {
            remove_audio_files(&plan, &config, true);
        }
        println!("{} (dry run - no changes made)", "✓".green());
        return;
    }

    // Confirm
    if !args.y {
        print!("Type y to confirm: ");
        io::stdout().flush().unwrap();
        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        if input.trim().to_lowercase() != "y" {
            println!("Aborted.");
            std::process::exit(0);
        }
        println!();
    }

    // Same DB scan lock index/sync use - acquired only now (not while waiting on the confirmation
    // prompt above) so delete's cascading writes never interleave with a running index/sync pass.
    if clear_stale_lock_minutes(&pool, common::lock::STALE_LOCK_MINUTES).await {
        eprintln!("{}", "Cleared a stale lock.".yellow());
    }
    let _lock_guard = match acquire_lock(&pool, "delete", std::process::id()).await {
        Ok(g) => g,
        Err(e) => {
            eprintln!("{}: {}", "Cannot start".red(), e);
            std::process::exit(1);
        }
    };

    println!("Deleting...");
    match execute_plan(&pool, &plan, &config, false).await {
        Ok((local, s3)) => {
            println!(
                "  {} {} local image(s), {} S3 object(s) removed",
                "✓".green(),
                local,
                s3
            );
        }
        Err(e) => {
            error_log::log_error(&format!("Database error: {}", e));
            eprintln!("  {} Database error: {}", "✗".red(), e);
            release_lock(&pool, "delete", std::process::id()).await;
            std::process::exit(1);
        }
    }

    if args.files {
        remove_audio_files(&plan, &config, false);
    }

    update_statistics(&pool).await.ok();
    release_lock(&pool, "delete", std::process::id()).await;

    println!();
    let kept = plan
        .artist_actions
        .iter()
        .filter(|a| a.other_credits_count > 0)
        .count();
    println!(
        "{} {} artist(s) deleted, {} kept as credit-only.",
        "✓".green().bold(),
        plan.artist_actions.len() - kept,
        kept
    );
    println!(
        "  {} local release(s), {} MB release(s) deleted.",
        plan.doomed_releases.len(),
        plan.mb_releases.len()
    );
}
