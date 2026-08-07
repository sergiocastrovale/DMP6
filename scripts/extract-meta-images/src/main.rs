//! Normalize every release's cover art to a `folder.jpg` on disk.
//!
//! `index` resolves a release's cover by checking for an external image file first and only then
//! probing an audio file's tags (see `common::images::release_cover_candidates`). Reading a JPEG is
//! far cheaper than a tag probe, so writing the embedded art out once - here - makes every later
//! index run take the cheap path.
//!
//! Read-mostly: the only thing ever written is a new `folder.jpg` in a release that had no cover
//! file. Existing images are never overwritten and audio files are never touched.

mod cover;
mod release;

use std::path::{Path, PathBuf};

use clap::Parser;
use colored::Colorize;
use common::progress::Reporter;
use cover::{process_release, Outcome};
use rayon::prelude::*;

#[derive(Parser, Debug)]
#[command(
    name = "extract-meta-images",
    about = "Extract embedded cover art to folder.jpg for every release that has no cover file"
)]
struct Args {
    /// Library root (defaults to MUSIC_DIR from web/.env)
    #[arg(long)]
    root: Option<String>,
    /// Only process these artists (semicolon-separated)
    #[arg(long, short)]
    only: Option<String>,
    /// Start of the artist range
    #[arg(long, short)]
    from: Option<String>,
    /// End of the artist range
    #[arg(long, short)]
    to: Option<String>,
    /// Exact match for --only (no prefix matching)
    #[arg(long)]
    exact: bool,
    /// Preview what would be written without touching disk
    #[arg(long)]
    dry_run: bool,
    /// Machine-readable progress output
    #[arg(long)]
    web: bool,
}

#[derive(Default)]
struct Totals {
    scanned: u64,
    skipped: u64,
    written: u64,
    no_art: u64,
    failed: u64,
}

/// Load `web/.env` without requiring a database.
///
/// Deliberately not `common::config::load_config` - that hard-expects DATABASE_URL, and a
/// filesystem-only script has no business needing a database to start.
fn load_music_dir(override_root: Option<String>) -> PathBuf {
    for path in [PathBuf::from("web/.env"), PathBuf::from("../../web/.env")] {
        if path.exists() {
            dotenvy::from_path(&path).ok();
            break;
        }
    }
    if let Ok(project_root) = std::env::var("PROJECT_ROOT") {
        let env_path = PathBuf::from(&project_root).join("web/.env");
        if env_path.exists() {
            dotenvy::from_path(env_path).ok();
        }
    }

    match override_root.or_else(|| std::env::var("MUSIC_DIR").ok()) {
        Some(root) => PathBuf::from(root),
        None => {
            eprintln!(
                "{}",
                "MUSIC_DIR not set. Pass --root /path/to/music or set it in web/.env.".bright_red()
            );
            std::process::exit(2);
        }
    }
}

fn process_artist(root: &Path, artist: &str, dry_run: bool, reporter: &Reporter) -> Totals {
    let releases = release::release_dirs_for_artist(root, artist);

    let outcomes: Vec<(PathBuf, Outcome)> = releases
        .par_iter()
        .map(|dir| (dir.clone(), process_release(dir, dry_run)))
        .collect();

    let mut totals = Totals {
        scanned: outcomes.len() as u64,
        ..Default::default()
    };

    for (dir, outcome) in &outcomes {
        let label = dir.strip_prefix(root).unwrap_or(dir).to_string_lossy();
        match outcome {
            Outcome::AlreadyHasCover => totals.skipped += 1,
            Outcome::Written => {
                totals.written += 1;
                reporter.sub_step(&format!("{} → folder.jpg", label));
            }
            Outcome::NoArt => totals.no_art += 1,
            Outcome::Failed(e) => {
                totals.failed += 1;
                reporter.err(&format!("{}: {}", label, e));
            }
        }
    }

    totals
}

fn main() {
    let args = Args::parse();
    common::error_log::init("extract-meta-images");

    let root = load_music_dir(args.root.clone());
    let reporter = Reporter::new(args.web);

    let artists = match release::list_artist_dirs(
        &root,
        args.from.as_deref().unwrap_or(""),
        args.to.as_deref().unwrap_or(""),
        args.only.as_deref().unwrap_or(""),
        args.exact,
    ) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{} {}: {}", "Cannot read".bright_red(), root.display(), e);
            std::process::exit(1);
        }
    };

    reporter.header(if args.dry_run {
        "extract-meta-images (dry run)"
    } else {
        "extract-meta-images"
    });
    reporter.kv("Library", &root.to_string_lossy());
    reporter.kv("Artists", &artists.len().to_string());
    reporter.blank();

    let mut totals = Totals::default();
    let total_artists = artists.len();

    for (idx, artist) in artists.iter().enumerate() {
        reporter.item("", artist, idx + 1, total_artists);
        let t = process_artist(&root, artist, args.dry_run, &reporter);
        totals.scanned += t.scanned;
        totals.skipped += t.skipped;
        totals.written += t.written;
        totals.no_art += t.no_art;
        totals.failed += t.failed;
    }

    reporter.blank();
    reporter.header("Summary");
    reporter.kv("Releases", &totals.scanned.to_string());
    reporter.kv("Had cover", &totals.skipped.to_string());
    reporter.kv(
        if args.dry_run {
            "Would write"
        } else {
            "Written"
        },
        &totals.written.to_string(),
    );
    reporter.kv("No art", &totals.no_art.to_string());
    reporter.kv("Failed", &totals.failed.to_string());

    if args.dry_run && totals.written > 0 {
        reporter.blank();
        reporter.info("Dry run - nothing was written. Re-run without --dry-run to apply.");
    }
}
