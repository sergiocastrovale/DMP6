//! `--fix:*` orchestration, generic across defect kinds.
//!
//! Shared here: building the worklist from the spool (never the xlsx - see the module doc on
//! `run_fix` for why), the safeguard against running with no prior scan, the fixed-row ledger, and
//! triggering the report regeneration that turns ledger entries into green rows and Summary counts.
//! Kind-specific: only how one release's worklist entries actually get resolved (`years::run`).

mod albumartist_missing;
mod artist_missing;
mod candidates;
mod tags;
mod text_normalize;
mod years;

use std::collections::BTreeMap;
use std::path::Path;

use colored::*;

use crate::checks::{self, ReasonCode};
use crate::fixed::{self, FixOutcome};
use crate::spool::{self, Paths};

/// Field umbrellas, each running every repair that applies to its field in a fixed precedence:
/// normalize in place -> derive from a sibling/folder source -> MusicBrainz (year only). One
/// release folder's worklist is shared across every repair module a kind dispatches to; each module
/// is independently self-contained and no-ops on a file whose own specific defect is not present -
/// see the module docs on `years`, `artist_missing`, `albumartist_missing`, `text_normalize`.
#[derive(Clone, Copy, Debug)]
pub enum FixKind {
    Year,
    Artist,
    AlbumArtist,
}

impl FixKind {
    fn codes(self) -> &'static [ReasonCode] {
        match self {
            Self::Year => &[
                ReasonCode::YearZero,
                ReasonCode::YearNonNumeric,
                ReasonCode::YearTwoDigit,
                ReasonCode::YearImplausible,
            ],
            Self::Artist => &[ReasonCode::ArtistMissing, ReasonCode::ArtistInvisibleChars],
            Self::AlbumArtist => &[
                ReasonCode::AlbumArtistMissing,
                ReasonCode::AlbumArtistUnknownArtist,
                ReasonCode::AlbumArtistUnrecognisedVarious,
                ReasonCode::AlbumArtistInvisibleChars,
                ReasonCode::AlbumArtistUntrimmed,
            ],
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Year => "year",
            Self::Artist => "artist",
            Self::AlbumArtist => "albumartist",
        }
    }
}

/// Concatenate two repair passes over the same worklist into one result.
fn merge(mut a: FixRunResult, b: FixRunResult) -> FixRunResult {
    a.outcomes.extend(b.outcomes);
    a.errors.extend(b.errors);
    a
}

/// One file this run could not resolve either way - never recorded in the ledger, so a failed file
/// can never end up silently marked green.
pub struct FixError {
    pub path: String,
    pub file: String,
    pub message: String,
}

#[derive(Default)]
pub struct FixRunResult {
    pub outcomes: Vec<FixOutcome>,
    pub errors: Vec<FixError>,
}

/// Rows from the spool whose rendered reason contains any of `codes`, grouped by release folder.
/// Shared by every fix kind - reading the spool (not the xlsx, which is a disposable, always-
/// regenerated artifact) is what the "no prior scan" safeguard in `run_fix` actually checks.
fn worklist(spool_path: &Path, codes: &[ReasonCode]) -> Result<BTreeMap<String, Vec<String>>, String> {
    let rows = spool::read_rows(spool_path)
        .map_err(|e| format!("cannot read spool at {}: {e}", spool_path.display()))?;
    let mut by_path: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in rows {
        let row_codes = checks::codes_in_rendered(&row.reason);
        if codes.iter().any(|c| row_codes.contains(c)) {
            by_path.entry(row.path).or_default().push(row.file);
        }
    }
    Ok(by_path)
}

#[allow(clippy::too_many_arguments)]
pub fn run_fix(
    kind: FixKind,
    root: &Path,
    output: &Path,
    work_dir: &Path,
    filters: &str,
    threads: usize,
    panic_strategy: &'static str,
    dry_run: bool,
) {
    let paths = Paths::in_dir(work_dir);

    // The actual safeguard: no prior `./problems --audit` means no spool, no worklist, and nothing
    // to regenerate `problems.xlsx` from. Checking the spool rather than the xlsx file is
    // deliberate - the xlsx is disposable and always rebuilt wholesale (same principle
    // `--report-only` already relies on), so a hand-deleted `problems.xlsx` alone does not block a
    // fix; only a missing spool does.
    if !paths.spool.exists() {
        eprintln!(
            "{}",
            format!(
                "No scan found at {} - run ./problems --audit first.",
                paths.spool.display()
            )
            .bright_red()
        );
        std::process::exit(2);
    }

    let list = match worklist(&paths.spool, kind.codes()) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("{}", e.bright_red());
            std::process::exit(1);
        }
    };
    if list.is_empty() {
        println!(
            "{}",
            format!("No {} rows in the spool.", kind.name()).green()
        );
        return;
    }

    let total_files: usize = list.values().map(|v| v.len()).sum();
    println!(
        "{}",
        format!(
            "{} release folder(s), {} file(s) to process{}",
            list.len(),
            total_files,
            if dry_run { " (dry run - no writes)" } else { "" }
        )
        .bright_cyan()
    );

    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    let result = rt.block_on(async {
        match kind {
            FixKind::Year => years::run(root, &list, dry_run).await,
            FixKind::Artist => {
                let missing = artist_missing::run(root, &list, dry_run).await?;
                let normalized = text_normalize::run(root, &list, dry_run).await?;
                Ok(merge(missing, normalized))
            }
            FixKind::AlbumArtist => {
                let missing = albumartist_missing::run(root, &list, dry_run).await?;
                let normalized = text_normalize::run(root, &list, dry_run).await?;
                Ok(merge(missing, normalized))
            }
        }
    });
    let result = match result {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{}", e.bright_red());
            std::process::exit(1);
        }
    };

    if !result.errors.is_empty() {
        println!();
        println!(
            "{}",
            format!("{} file(s) left untouched:", result.errors.len()).yellow()
        );
        for e in &result.errors {
            println!("  {} {}/{}: {}", "!".bright_red(), e.path, e.file, e.message);
        }
    }

    println!();
    println!(
        "{}",
        format!(
            "{} resolved ({} set, {} cleared), {} error(s)",
            result.outcomes.len(),
            result.outcomes.iter().filter(|o| o.action == "set").count(),
            result
                .outcomes
                .iter()
                .filter(|o| o.action == "cleared")
                .count(),
            result.errors.len(),
        )
        .bold()
    );

    if dry_run {
        println!(
            "{}",
            "Dry run - nothing written, no ledger update, no report regenerated.".bright_black()
        );
        return;
    }

    if let Err(e) = fixed::append(&paths.fixed, &result.outcomes) {
        eprintln!("{}", format!("Cannot write fixed ledger: {e}").bright_red());
        std::process::exit(1);
    }

    // Regenerate problems.xlsx from the spool + updated ledger - green rows and the Summary sheet's
    // Fixed column now reflect this run, via the same path --report-only uses.
    crate::regenerate_report(&paths, output, root, filters, threads, panic_strategy);
}
