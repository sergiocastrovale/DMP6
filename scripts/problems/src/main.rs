//! `problems` - library-wide audio tag defect scanner, with a MusicBrainz-verified fixer built in.
//!
//! `--audit` walks a music library, reports every tag condition known to break or degrade the DMP
//! index/sync pipeline, and writes an XLSX report. **Strictly read-only**: it opens audio files for
//! reading and never writes, moves, renames or deletes one.
//!
//! `--fix:<type>` resolves defects `--audit` found, one field umbrella at a time
//! (`year`/`artist`/`albumartist`), writing tags only when the source is reliable - see
//! `fix/mod.rs`. Exactly one of `--audit` / `--fix:<type>` is required per run.

mod audio;
mod checks;
mod filter;
mod fix;
mod fixed;
mod id3raw;
mod progress;
mod report;
mod scan;
mod spool;

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use clap::{ArgGroup, Parser};
use colored::*;

use fix::FixKind;
use fixed::FixedIndex;
use progress::{format_duration, Counters, Progress};
use scan::CodeCounts;
use spool::{load_state, save_state, Paths, ScanState, SpoolWriter};

#[derive(Parser, Debug)]
#[command(
    name = "problems",
    about = "Scan a music library for tag defects (--audit) or fix ones with a reliable source (--fix:<type>).",
    group(ArgGroup::new("mode").args(["audit", "fix_year", "fix_artist", "fix_albumartist"]).required(true))
)]
struct Args {
    /// Scan the library and write problems.xlsx. Never modifies audio files.
    #[arg(long)]
    audit: bool,

    /// Fix every year defect this build knows how to: YEAR_ZERO / YEAR_NON_NUMERIC resolved against
    /// MusicBrainz on a perfect match, otherwise cleared. Requires a prior --audit (reads its spool).
    #[arg(long = "fix:year")]
    fix_year: bool,

    /// Fix every artist-field defect this build knows how to: a missing artist tag filled from the
    /// file's own albumArtist or a folder-wide majority (never MusicBrainz - there's nothing to
    /// search by on files whose title is often also empty), then invisible characters stripped.
    /// Requires a prior --audit (reads its spool).
    #[arg(long = "fix:artist")]
    fix_artist: bool,

    /// Fix every albumArtist-field defect this build knows how to: machine-junk (track
    /// number/bare year/bitrate suffix) replaced from the file's own artist tag or a folder-wide
    /// majority, then invisible characters stripped and whitespace trimmed. Never MusicBrainz.
    /// Requires a prior --audit (reads its spool).
    #[arg(long = "fix:albumartist")]
    fix_albumartist: bool,

    /// --fix:* only: print what would change without writing any tags or updating the ledger.
    #[arg(long)]
    dry_run: bool,

    /// Music library root. Defaults to $MUSIC_DIR. --fix:* only needs this to open files.
    #[arg(long)]
    root: Option<String>,

    /// Output XLSX path. Defaults to <work-dir>/problems.xlsx.
    #[arg(long, short)]
    output: Option<String>,

    /// Directory for the spool, checkpoint, fixed-row ledger and default report location.
    #[arg(long)]
    work_dir: Option<String>,

    #[arg(
        long,
        default_value = "",
        help = "--audit only: only artist folders from this prefix"
    )]
    from: String,

    #[arg(
        long,
        default_value = "",
        help = "--audit only: only artist folders up to this prefix"
    )]
    to: String,

    #[arg(
        long,
        default_value = "",
        help = "--audit only: only artist folders starting with this prefix"
    )]
    only: String,

    #[arg(long, help = "--audit only: make --only an exact match")]
    exact: bool,

    #[arg(
        long,
        default_value_t = 16,
        help = "--audit only: worker threads (NAS I/O bound; try 8/16/24)"
    )]
    threads: usize,

    #[arg(
        long,
        help = "--audit only: stop after roughly this many files (smoke testing)"
    )]
    limit_files: Option<usize>,

    #[arg(long, help = "--audit only: continue a previous interrupted scan")]
    resume: bool,

    #[arg(
        long,
        help = "--audit only: discard any previous scan state and start over"
    )]
    restart: bool,

    #[arg(
        long,
        help = "--audit only: skip scanning; rebuild the report from an existing spool"
    )]
    report_only: bool,

    #[arg(long, help = "--audit only: disable the live progress line")]
    no_progress: bool,
}

/// Host-visible output directory.
///
/// Mirrors `common::error_log`: in the container `PROJECT_ROOT=/app` and `${DMP_DATA}/logs` is
/// bind-mounted at `/app/data/logs`, so this lands somewhere that survives the container and is
/// readable from the NAS. `reports/` is deliberately not used - it is not a mount, so anything
/// written there is invisible from the host and dies with the container.
fn default_work_dir() -> PathBuf {
    match std::env::var("PROJECT_ROOT") {
        Ok(root) => PathBuf::from(root).join("data").join("logs"),
        Err(_) => PathBuf::from("reports"),
    }
}

fn main() {
    let args = Args::parse();
    audio::install_quiet_panic_hook();

    let root = match args
        .root
        .clone()
        .or_else(|| std::env::var("MUSIC_DIR").ok())
    {
        Some(r) => PathBuf::from(r),
        None => {
            eprintln!(
                "{}",
                "MUSIC_DIR not set. Pass --root /path/to/music.".bright_red()
            );
            std::process::exit(2);
        }
    };
    if !root.is_dir() {
        eprintln!(
            "{}",
            format!("Not a directory: {}", root.display()).bright_red()
        );
        std::process::exit(2);
    }

    let work_dir = args
        .work_dir
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(default_work_dir);
    std::fs::create_dir_all(&work_dir).ok();
    let output = args
        .output
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(|| work_dir.join("problems.xlsx"));

    let panic_strategy = if cfg!(panic = "abort") {
        "abort"
    } else {
        "unwind"
    };

    let fix_mode = if args.fix_year {
        Some((
            FixKind::Year,
            "fix:year (MusicBrainz on a perfect match, otherwise clears the field)",
        ))
    } else if args.fix_artist {
        Some((
            FixKind::Artist,
            "fix:artist (fills from albumArtist/folder majority, then strips invisible characters - never MusicBrainz)",
        ))
    } else if args.fix_albumartist {
        Some((
            FixKind::AlbumArtist,
            "fix:albumartist (fills from artist/folder majority, then normalizes - never MusicBrainz)",
        ))
    } else {
        None
    };

    println!(
        "{}",
        format!(
            "DMP tag problem {}",
            if fix_mode.is_some() { "fix" } else { "scan" }
        )
        .bright_cyan()
        .bold()
    );
    println!("{}", "===================".bright_black());
    println!(
        "{:<14}: {}",
        "Music dir",
        root.display().to_string().bright_white()
    );
    println!(
        "{:<14}: {}",
        "Work dir",
        work_dir.display().to_string().bright_white()
    );

    if let Some((kind, mode_desc)) = fix_mode {
        println!("{:<14}: {}", "Mode", mode_desc.bright_white());
        println!();
        fix::run_fix(
            kind,
            &root,
            &output,
            &work_dir,
            "none",
            args.threads,
            panic_strategy,
            args.dry_run,
        );
        return;
    }

    run_audit(&args, &root, &work_dir, &output, panic_strategy);
}

fn run_audit(
    args: &Args,
    root: &Path,
    work_dir: &Path,
    output: &Path,
    panic_strategy: &'static str,
) {
    let paths = Paths::in_dir(work_dir);

    let filter_key = filter::filter_key(&args.from, &args.to, &args.only, args.exact);
    let filters = if args.from.is_empty() && args.to.is_empty() && args.only.is_empty() {
        "none".to_string()
    } else {
        format!(
            "from={} to={} only={} exact={}",
            args.from, args.to, args.only, args.exact
        )
    };

    println!(
        "{:<14}: {}",
        "Report",
        output.display().to_string().bright_white()
    );
    println!("{:<14}: {}", "Filters", filters.bright_white());
    println!(
        "{:<14}: {}",
        "Threads",
        args.threads.to_string().bright_white()
    );
    println!(
        "{:<14}: {}",
        "Mode",
        "read-only (never modifies audio files)".bright_white()
    );

    if panic_strategy == "abort" {
        eprintln!(
            "{}",
            "WARNING: built with panic=abort - one corrupt file that crashes the tag parser will \
             kill this run. Rebuild with `cargo build --profile scan -p problems`. (--resume can \
             pick up where it died.)"
                .yellow()
        );
    }
    println!();

    if args.report_only {
        regenerate_report(&paths, output, root, &filters, args.threads, panic_strategy);
        return;
    }

    // Resume/restart handshake. Refusing to guess here is deliberate: silently clobbering a
    // multi-hour scan is not a recoverable mistake.
    let existing = load_state(&paths.state);
    let mut state = match (&existing, args.resume, args.restart) {
        (Some(_), false, false) => {
            eprintln!(
                "{}",
                format!(
                    "A previous scan state exists at {}.\n  Pass --resume to continue it, or \
                     --restart to discard it and start over.",
                    paths.state.display()
                )
                .bright_red()
            );
            std::process::exit(2);
        }
        (Some(prev), true, _) => {
            if prev.filter_key != filter_key {
                eprintln!(
                    "{}",
                    format!(
                        "Cannot resume: that scan used different filters.\n  previous: {}\n  now:      {}",
                        prev.filter_key, filter_key
                    )
                    .bright_red()
                );
                std::process::exit(2);
            }
            println!(
                "  {} resuming after '{}' ({} artists, {} files done)",
                "→".bright_black(),
                prev.last_artist.clone().unwrap_or_default(),
                prev.artists_done,
                prev.files_scanned
            );
            prev.clone()
        }
        _ => ScanState::new(&root.display().to_string(), &filter_key),
    };

    let resuming = existing.is_some() && args.resume;
    let mut spool = match if resuming {
        SpoolWriter::open_for_resume(&paths.spool, state.spool_bytes)
    } else {
        SpoolWriter::create(&paths.spool)
    } {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{}", format!("Cannot open spool: {e}").bright_red());
            std::process::exit(1);
        }
    };

    rayon::ThreadPoolBuilder::new()
        .num_threads(args.threads.max(1))
        .build_global()
        .ok();

    let artists = match scan::list_artist_dirs(root, &args.from, &args.to, &args.only, args.exact)
    {
        Ok(a) => a,
        Err(e) => {
            eprintln!(
                "{}",
                format!("Cannot read {}: {e}", root.display()).bright_red()
            );
            std::process::exit(1);
        }
    };

    // Skip everything already completed. Comparison matches the sort order used when listing.
    let pending: Vec<String> = match state.last_artist.as_deref().filter(|_| resuming) {
        Some(last) => {
            let lastl = last.to_lowercase();
            artists
                .into_iter()
                .filter(|a| a.to_lowercase() > lastl)
                .collect()
        }
        None => artists,
    };

    println!(
        "{:<14}: {} artist folder(s) to scan",
        "Queue",
        pending.len()
    );
    println!();

    let counters = Arc::new(Counters::default());
    counters.files.store(state.files_scanned, Ordering::Relaxed);
    counters
        .problem_files
        .store(state.problem_files, Ordering::Relaxed);
    counters
        .problem_instances
        .store(state.problem_instances, Ordering::Relaxed);
    counters.folders.store(state.folders, Ordering::Relaxed);
    counters
        .artists_done
        .store(state.artists_done, Ordering::Relaxed);

    let total_artists = state.artists_done + pending.len() as u64;
    let progress = Progress::start(counters.clone(), total_artists, args.no_progress);
    let started = Instant::now();
    let current_year: i32 = chrono::Local::now()
        .format("%Y")
        .to_string()
        .parse()
        .unwrap_or(2026);

    let mut counts: CodeCounts = CodeCounts::new();
    let mut stopped_early = false;

    for artist in &pending {
        progress.set_label(artist);

        let remaining = args
            .limit_files
            .map(|lim| lim.saturating_sub(counters.files.load(Ordering::Relaxed) as usize));
        if remaining == Some(0) {
            stopped_early = true;
            break;
        }

        let batch = scan::scan_artist(root, artist, current_year, &counters, remaining);
        scan::merge_counts(&mut counts, &batch.counts);

        if let Err(e) = spool.write_rows(&batch.rows).and_then(|_| spool.sync()) {
            progress.finish();
            eprintln!("{}", format!("Cannot write spool: {e}").bright_red());
            std::process::exit(1);
        }

        counters.artists_done.fetch_add(1, Ordering::Relaxed);
        state.last_artist = Some(artist.clone());
        state.artists_done = counters.artists_done.load(Ordering::Relaxed);
        state.files_scanned = counters.files.load(Ordering::Relaxed);
        state.problem_files = counters.problem_files.load(Ordering::Relaxed);
        state.problem_instances = counters.problem_instances.load(Ordering::Relaxed);
        state.folders = counters.folders.load(Ordering::Relaxed);
        state.spool_bytes = spool.bytes();
        state.updated_at = chrono::Local::now().to_rfc3339();
        save_state(&paths.state, &state).ok();
    }

    progress.finish();

    let elapsed = started.elapsed();
    let info = report::RunInfo {
        root: root.display().to_string(),
        started_at: state.started_at.clone(),
        finished_at: chrono::Local::now().to_rfc3339(),
        duration: format_duration(elapsed),
        threads: args.threads,
        filters,
        artists: counters.artists_done.load(Ordering::Relaxed),
        folders: counters.folders.load(Ordering::Relaxed),
        files: counters.files.load(Ordering::Relaxed),
        problem_files: counters.problem_files.load(Ordering::Relaxed),
        problem_instances: counters.problem_instances.load(Ordering::Relaxed),
        unreadable: counters.unreadable.load(Ordering::Relaxed),
        panicked: audio::PANIC_COUNT.load(Ordering::Relaxed),
        panic_strategy,
    };

    emit_report(&paths, output, &counts, &info);

    if stopped_early {
        println!("  {} stopped at --limit-files", "→".bright_black());
    }
    print_summary(&info, output);
}

/// Rebuild the workbook from an existing spool without rescanning.
///
/// Worth having on its own: after a multi-hour scan, an XLSX write failure (bad path, full disk)
/// should cost seconds to retry, not another full run. Also what `fix::run_fix` calls after a
/// non-dry-run fix, so the ledger's new entries turn into green rows and updated Summary counts
/// immediately - no separate marking step.
pub fn regenerate_report(
    paths: &Paths,
    output: &Path,
    root: &Path,
    filters: &str,
    threads: usize,
    panic_strategy: &'static str,
) {
    let state = load_state(&paths.state);
    if !paths.spool.exists() {
        eprintln!(
            "{}",
            format!(
                "No spool at {} - nothing to report on.",
                paths.spool.display()
            )
            .bright_red()
        );
        std::process::exit(2);
    }

    // Counts are not persisted, so recompute them from the spool's rendered reasons.
    let mut counts = CodeCounts::new();
    let mut rows_seen = 0u64;
    if let Ok(rows) = spool::read_rows(&paths.spool) {
        for row in rows {
            rows_seen += 1;
            for code in checks::codes_in_rendered(&row.reason) {
                *counts.entry(code).or_default() += 1;
            }
        }
    }

    let info = report::RunInfo {
        root: root.display().to_string(),
        started_at: state
            .as_ref()
            .map(|s| s.started_at.clone())
            .unwrap_or_default(),
        finished_at: chrono::Local::now().to_rfc3339(),
        duration: "(report-only)".into(),
        threads,
        filters: filters.to_string(),
        artists: state.as_ref().map(|s| s.artists_done).unwrap_or(0),
        folders: 0,
        files: state.as_ref().map(|s| s.files_scanned).unwrap_or(0),
        problem_files: rows_seen,
        problem_instances: counts.values().sum(),
        unreadable: 0,
        panicked: 0,
        panic_strategy,
    };

    emit_report(paths, output, &counts, &info);
    print_summary(&info, output);
}

fn emit_report(paths: &Paths, output: &Path, counts: &CodeCounts, info: &report::RunInfo) {
    let rows = match spool::read_rows(&paths.spool) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{}", format!("Cannot read spool: {e}").bright_red());
            std::process::exit(1);
        }
    };
    let fixed = FixedIndex::load(&paths.fixed);
    match report::write_report(output, rows, counts, info, &fixed) {
        Ok(stats) => {
            if stats.rolled_over {
                println!(
                    "  {} row cap reached - problems continue across {} sheets",
                    "→".bright_black(),
                    stats.sheets_used
                );
            }
        }
        Err(e) => {
            eprintln!("{}", format!("Cannot write report: {e}").bright_red());
            eprintln!(
                "  The spool is intact at {} - fix the path and re-run with --audit --report-only.",
                paths.spool.display()
            );
            std::process::exit(1);
        }
    }
}

fn print_summary(info: &report::RunInfo, output: &Path) {
    println!();
    println!("{}", "═".repeat(60).bright_black());
    println!();
    println!("{}", format!("Done. ({})", info.duration).green().bold());
    println!(
        "  Files: {} | Flagged: {} | Problems: {} | Unreadable: {} | Panics: {}",
        info.files, info.problem_files, info.problem_instances, info.unreadable, info.panicked
    );
    println!("  Report: {}", output.display().to_string().bright_white());
}
