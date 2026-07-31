mod corrupted;
mod duplicates;
mod missing;
mod orphans;
mod revert;
mod tags;
mod unsplit;

use std::collections::HashSet;
use std::process::Command;

use clap::Parser;
use colored::Colorize;
use common::{
    config::{apply_db_overrides, load_config},
    db::create_pool,
    error_log,
    lock::{acquire_lock, clear_stale_lock_minutes, release_lock},
};

#[derive(Parser, Debug)]
#[command(name = "fix", about = "Apply fixes for PENDING metadata issues")]
struct Args {
    /// Fix corrupted TPE2 issues
    #[arg(long)]
    corrupted: bool,
    /// Fix unsplit compound artist issues
    #[arg(long)]
    unsplit: bool,
    /// Fix orphan artist issues (delete them)
    #[arg(long)]
    orphans: bool,
    /// Fix duplicate artist issues (merge B into A)
    #[arg(long)]
    duplicates: bool,
    /// Fix missing metadata issues
    #[arg(long)]
    missing: bool,
    /// Revert previously applied fixes instead of applying new ones
    #[arg(long)]
    revert: bool,
    /// Revert mode: 'undo' (back to DETECTED) or 'undo-resolved' (stays RESOLVED)
    #[arg(long, default_value = "undo")]
    mode: String,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    common::error_log::init("fix");
    let mut config = load_config(None);
    let pool = create_pool(&config.database_url).await;
    apply_db_overrides(&mut config, &pool).await;

    if !args.corrupted && !args.unsplit && !args.orphans && !args.duplicates && !args.missing {
        eprintln!("{}", "Specify at least one fix type: --corrupted, --unsplit, --orphans, --duplicates, --missing".red());
        std::process::exit(1);
    }

    // Same DB scan lock index/sync use - fix rewrites tags and merges/deletes artists, so it must
    // not run concurrently with an index/sync pass touching the same rows.
    if clear_stale_lock_minutes(&pool, 10).await {
        eprintln!("{}", "Cleared a stale lock.".yellow());
    }
    if let Err(e) = acquire_lock(&pool, "fix", std::process::id(), "").await {
        eprintln!("{}: {}", "Cannot start".red(), e);
        std::process::exit(1);
    }

    let music_dir = config.music_dir.as_deref().unwrap_or("").to_string();
    let mut affected_folders: HashSet<String> = HashSet::new();
    let mut had_file_writes = false;

    if args.revert {
        if args.corrupted {
            println!("{}", "↩ Reverting corrupted TPE2 fixes...".cyan().bold());
            match revert::revert(&pool, &music_dir, "corrupted", &args.mode).await {
                Ok((ok, fail, artists)) => {
                    println!("  {} reverted, {} failed", ok.to_string().green(), fail.to_string().red());
                    affected_folders.extend(artists);
                    if ok > 0 { had_file_writes = true; }
                }
                Err(e) => { error_log::log_error(&e.to_string()); eprintln!("  {}: {}", "ERROR".red(), e); }
            }
        }
        if args.unsplit {
            println!("{}", "↩ Reverting unsplit artist fixes...".cyan().bold());
            match revert::revert(&pool, &music_dir, "unsplit", &args.mode).await {
                Ok((ok, fail, artists)) => {
                    println!("  {} reverted, {} failed", ok.to_string().green(), fail.to_string().red());
                    affected_folders.extend(artists);
                    if ok > 0 { had_file_writes = true; }
                }
                Err(e) => { error_log::log_error(&e.to_string()); eprintln!("  {}: {}", "ERROR".red(), e); }
            }
        }
        if args.missing {
            println!("{}", "↩ Reverting missing metadata fixes...".cyan().bold());
            match revert::revert(&pool, &music_dir, "missing", &args.mode).await {
                Ok((ok, fail, artists)) => {
                    println!("  {} reverted, {} failed", ok.to_string().green(), fail.to_string().red());
                    affected_folders.extend(artists);
                    if ok > 0 { had_file_writes = true; }
                }
                Err(e) => { error_log::log_error(&e.to_string()); eprintln!("  {}: {}", "ERROR".red(), e); }
            }
        }
        if args.orphans || args.duplicates {
            error_log::log_warn("Revert not supported for orphans or duplicates.");
            eprintln!("{}", "Revert not supported for orphans or duplicates.".yellow());
        }
    } else {
        if args.corrupted {
            println!("{}", "→ Fixing corrupted TPE2 issues...".cyan().bold());
            match corrupted::fix(&pool, &music_dir).await {
                Ok((ok, fail, artists)) => {
                    println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red());
                    affected_folders.extend(artists);
                    if ok > 0 { had_file_writes = true; }
                }
                Err(e) => { error_log::log_error(&e.to_string()); eprintln!("  {}: {}", "ERROR".red(), e); }
            }
        }

        if args.unsplit {
            println!("{}", "→ Fixing unsplit artist issues...".cyan().bold());
            match unsplit::fix(&pool, &music_dir).await {
                Ok((ok, fail, artists)) => {
                    println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red());
                    affected_folders.extend(artists);
                    if ok > 0 { had_file_writes = true; }
                }
                Err(e) => { error_log::log_error(&e.to_string()); eprintln!("  {}: {}", "ERROR".red(), e); }
            }
        }

        if args.orphans {
            println!("{}", "→ Fixing orphan artist issues...".cyan().bold());
            match orphans::fix(&pool, &config).await {
                Ok((ok, fail)) => println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red()),
                Err(e) => { error_log::log_error(&e.to_string()); eprintln!("  {}: {}", "ERROR".red(), e); }
            }
        }

        if args.duplicates {
            println!("{}", "→ Fixing duplicate artist issues...".cyan().bold());
            match duplicates::fix(&pool, &config, &music_dir).await {
                Ok((ok, fail, artists)) => {
                    println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red());
                    affected_folders.extend(artists);
                    if ok > 0 { had_file_writes = true; }
                }
                Err(e) => { error_log::log_error(&e.to_string()); eprintln!("  {}: {}", "ERROR".red(), e); }
            }
        }

        if args.missing {
            println!("{}", "→ Fixing missing metadata issues...".cyan().bold());
            match missing::fix(&pool, &music_dir).await {
                Ok((ok, fail, artists)) => {
                    println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red());
                    affected_folders.extend(artists);
                    if ok > 0 { had_file_writes = true; }
                }
                Err(e) => { error_log::log_error(&e.to_string()); eprintln!("  {}: {}", "ERROR".red(), e); }
            }
        }
    }

    // Release before spawning `index` as a subprocess below - it takes the same lock itself, and
    // fix's own destructive work is done at this point.
    release_lock(&pool).await;

    if had_file_writes && !affected_folders.is_empty() {
        let folders = affected_folders.into_iter().collect::<Vec<_>>().join(";");
        println!("\n{}", "→ Re-indexing affected folders...".cyan().bold());
        println!("  Folders: {}", folders);

        let exe = std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .map(|d| d.join("index"))
            .unwrap_or_else(|| std::path::PathBuf::from("./index"));

        let status = Command::new(&exe)
            .args(["--folders", &folders, "--skip-covers"])
            .status();

        match status {
            Ok(s) if s.success() => println!("  {}", "Re-index complete.".green()),
            Ok(s) => { error_log::log_warn(&format!("index exited with code {}", s.code().unwrap_or(-1))); eprintln!("  {} index exited with code {}", "⚠".yellow(), s.code().unwrap_or(-1)); }
            Err(e) => { error_log::log_error(&format!("Failed to run index: {}", e)); eprintln!("  {} Failed to run index: {}", "✗".red(), e); }
        }
    }

    if let Err(e) = common::statistics::update_statistics(&pool).await {
        error_log::log_warn(&format!("failed to update statistics: {}", e));
        eprintln!("Warning: failed to update statistics: {}", e);
    }

    println!("{}", "Done.".green().bold());
}

pub fn folder_from_path(file_path: &str) -> Option<String> {
    file_path.rsplit_once('/').map(|(dir, _)| dir.to_string()).filter(|s| !s.is_empty())
}
