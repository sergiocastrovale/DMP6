mod assign;
mod corrupted;
mod duplicates;
mod missing;
mod orphans;
mod revert;
mod tags;

use std::collections::HashSet;
use std::process::Command;

use clap::{Parser, ValueEnum};
use common::{
    config::{apply_db_overrides, load_config},
    db::create_pool_or_exit,
    error_log,
    lock::{acquire_lock, clear_stale_lock_minutes, release_lock},
    progress::Reporter,
};

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RevertMode {
    /// Back to DETECTED - the issue is queued again next time it's picked up.
    Undo,
    /// Stays RESOLVED - the file/DB change is undone, the issue is not re-queued.
    UndoResolved,
}

#[derive(Parser, Debug)]
#[command(name = "fix", about = "Apply fixes for PENDING metadata issues")]
struct Args {
    /// Fix corrupted TPE2 issues
    #[arg(long)]
    corrupted: bool,
    /// Fix orphan artist issues (delete them)
    #[arg(long)]
    orphans: bool,
    /// Fix duplicate artist issues (merge B into A)
    #[arg(long)]
    duplicates: bool,
    /// Fix missing metadata issues
    #[arg(long)]
    missing: bool,
    /// Revert already-applied fixes instead of applying new ones
    #[arg(long)]
    revert: bool,
    /// Revert mode
    #[arg(long, value_enum, default_value_t = RevertMode::Undo)]
    mode: RevertMode,
    /// Print what would be fixed without writing files or the database
    #[arg(long)]
    dry_run: bool,
    /// Say which artist a release belongs to: write this MusicBrainz artist id (--mbid) into the album-artist id of
    /// every file of --release or --folder, then re-index them. For two artists sharing a name, and for a download
    /// being merged for a known artist.
    #[arg(long, requires = "mbid")]
    assign_artist: bool,
    /// With --assign-artist: the MusicBrainz artist id to write.
    #[arg(long)]
    mbid: Option<String>,
    /// With --assign-artist: the LocalRelease id whose files to write.
    #[arg(long, conflicts_with = "folder")]
    release: Option<String>,
    /// With --assign-artist: a folder (relative to MUSIC_DIR, or absolute) whose audio files to write.
    #[arg(long)]
    folder: Option<String>,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    common::error_log::init("fix");
    let reporter = Reporter::new(false);
    let mut config = load_config(None);
    let pool = create_pool_or_exit(&config.database_url, "fix").await;
    apply_db_overrides(&mut config, &pool).await;

    reporter.header("DMP Fix");
    if args.dry_run {
        reporter.kv("Mode", "dry run");
    }
    reporter.blank();

    if !args.corrupted && !args.orphans && !args.duplicates && !args.missing && !args.assign_artist {
        reporter.failed(
            "Specify at least one fix type: --corrupted, --orphans, --duplicates, --missing, --assign-artist",
        );
        std::process::exit(1);
    }
    let assign_mbid = args.mbid.as_deref().and_then(common::filters::sanitize_mb_id);
    if args.assign_artist && (assign_mbid.is_none() || (args.release.is_none() && args.folder.is_none())) {
        reporter.failed("--assign-artist needs a valid --mbid and one of --release or --folder");
        std::process::exit(1);
    }

    if args.dry_run && args.revert {
        reporter.failed("--dry-run is not supported with --revert.");
        std::process::exit(1);
    }

    // Same DB scan lock index/sync use - fix rewrites tags and merges/deletes artists, so it must
    // not run concurrently with an index/sync pass touching the same rows.
    if clear_stale_lock_minutes(&pool, common::lock::STALE_LOCK_MINUTES).await {
        reporter.warn("Cleared a stale lock.");
    }
    let _lock_guard = match acquire_lock(&pool, "fix", std::process::id()).await {
        Ok(g) => g,
        Err(e) => {
            reporter.failed(&format!("Cannot start: {}", e));
            std::process::exit(1);
        }
    };

    let music_dir = config.music_dir.as_deref().unwrap_or("").to_string();
    let mut affected_folders: HashSet<String> = HashSet::new();
    let mut had_file_writes = false;

    if args.revert {
        if args.corrupted {
            reporter.step("Reverting corrupted TPE2 fixes...");
            match revert::revert(&pool, &music_dir, "corrupted", args.mode, &reporter).await {
                Ok((ok, fail, artists)) => {
                    reporter
                        .nested()
                        .ok(&format!("{} reverted, {} failed", ok, fail));
                    affected_folders.extend(artists);
                    if ok > 0 {
                        had_file_writes = true;
                    }
                }
                Err(e) => {
                    error_log::log_error(&e.to_string());
                    reporter.nested().warn(&e.to_string());
                }
            }
        }
        if args.missing {
            reporter.step("Reverting missing metadata fixes...");
            match revert::revert(&pool, &music_dir, "missing", args.mode, &reporter).await {
                Ok((ok, fail, artists)) => {
                    reporter
                        .nested()
                        .ok(&format!("{} reverted, {} failed", ok, fail));
                    affected_folders.extend(artists);
                    if ok > 0 {
                        had_file_writes = true;
                    }
                }
                Err(e) => {
                    error_log::log_error(&e.to_string());
                    reporter.nested().warn(&e.to_string());
                }
            }
        }
        if args.orphans || args.duplicates {
            reporter.warn("Revert not supported for orphans or duplicates.");
        }
    } else {
        if args.corrupted {
            reporter.step("Fixing corrupted TPE2 issues...");
            match corrupted::fix(&pool, &music_dir, args.dry_run, &reporter).await {
                Ok((ok, fail, artists)) => {
                    reporter
                        .nested()
                        .ok(&format!("{} resolved, {} failed", ok, fail));
                    affected_folders.extend(artists);
                    if ok > 0 {
                        had_file_writes = true;
                    }
                }
                Err(e) => {
                    error_log::log_error(&e.to_string());
                    reporter.nested().warn(&e.to_string());
                }
            }
        }

        if args.orphans {
            reporter.step("Fixing orphan artist issues...");
            match orphans::fix(&pool, &config, args.dry_run, &reporter).await {
                Ok((ok, fail)) => reporter
                    .nested()
                    .ok(&format!("{} resolved, {} failed", ok, fail)),
                Err(e) => {
                    error_log::log_error(&e.to_string());
                    reporter.nested().warn(&e.to_string());
                }
            }
        }

        if args.duplicates {
            reporter.step("Fixing duplicate artist issues...");
            match duplicates::fix(&pool, &config, &music_dir, args.dry_run, &reporter).await {
                Ok((ok, fail, artists)) => {
                    reporter
                        .nested()
                        .ok(&format!("{} resolved, {} failed", ok, fail));
                    affected_folders.extend(artists);
                    if ok > 0 {
                        had_file_writes = true;
                    }
                }
                Err(e) => {
                    error_log::log_error(&e.to_string());
                    reporter.nested().warn(&e.to_string());
                }
            }
        }

        if args.assign_artist {
            reporter.step("Assigning the release to its artist...");
            let target = match (&args.release, &args.folder) {
                (Some(r), _) => assign::Target::Release(r),
                (None, Some(f)) => assign::Target::Folder(f),
                (None, None) => unreachable!("checked above"),
            };
            match assign::assign(&pool, &music_dir, target, assign_mbid.as_deref().unwrap_or_default(), args.dry_run, &reporter).await {
                Ok((ok, fail, folders)) => {
                    reporter.nested().ok(&format!("{} file(s) written, {} failed", ok, fail));
                    if ok > 0 && !args.dry_run {
                        had_file_writes = true;
                    }
                    affected_folders.extend(folders);
                }
                Err(e) => {
                    error_log::log_error(&e);
                    reporter.nested().warn(&e);
                    release_lock(&pool, "fix", std::process::id()).await;
                    std::process::exit(1);
                }
            }
        }

        if args.missing {
            reporter.step("Fixing missing metadata issues...");
            match missing::fix(&pool, &music_dir, args.dry_run, &reporter).await {
                Ok((ok, fail, artists)) => {
                    reporter
                        .nested()
                        .ok(&format!("{} resolved, {} failed", ok, fail));
                    affected_folders.extend(artists);
                    if ok > 0 {
                        had_file_writes = true;
                    }
                }
                Err(e) => {
                    error_log::log_error(&e.to_string());
                    reporter.nested().warn(&e.to_string());
                }
            }
        }
    }

    // Release before spawning `index` as a subprocess below - it takes the same lock itself, and
    // fix's own destructive work is done at this point.
    release_lock(&pool, "fix", std::process::id()).await;

    if had_file_writes && !affected_folders.is_empty() {
        let folders = affected_folders.into_iter().collect::<Vec<_>>().join(";");
        reporter.blank();
        reporter.step("Re-indexing affected folders...");
        reporter.nested().kv("Folders", &folders);

        let exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .map(|d| d.join("index"))
            .unwrap_or_else(|| std::path::PathBuf::from("./index"));

        let status = Command::new(&exe)
            .args(["--folders", &folders, "--skip-covers"])
            .status();

        match status {
            Ok(s) if s.success() => reporter.nested().ok("Re-index complete."),
            Ok(s) => {
                let code = s.code().unwrap_or(-1);
                error_log::log_warn(&format!("index exited with code {}", code));
                reporter
                    .nested()
                    .warn(&format!("index exited with code {}", code));
            }
            Err(e) => {
                error_log::log_error(&format!("Failed to run index: {}", e));
                reporter
                    .nested()
                    .warn(&format!("Failed to run index: {}", e));
            }
        }
    }

    if !args.dry_run {
        if let Err(e) = common::statistics::update_statistics(&pool).await {
            error_log::log_warn(&format!("failed to update statistics: {}", e));
            reporter.warn(&format!("failed to update statistics: {}", e));
        }
    }

    reporter.done("Done.");
}

pub fn folder_from_path(file_path: &str) -> Option<String> {
    file_path
        .rsplit_once('/')
        .map(|(dir, _)| dir.to_string())
        .filter(|s| !s.is_empty())
}
