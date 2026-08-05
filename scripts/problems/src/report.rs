//! XLSX report generation.
//!
//! Two kinds of sheet, and the difference matters structurally:
//!
//! * **Summary** is a normal worksheet, created *first* so it is the leftmost tab but written
//!   *last*, once totals are known. Constant-memory sheets can only be written top-to-bottom, so a
//!   summary built that way would have to be written before the data it summarises.
//! * **Problems** sheets are constant-memory: rows stream straight to a tempfile instead of being
//!   held in RAM. With a library this size the row count is exactly the unknown the tool exists to
//!   measure, so the writer has to work when it turns out to be millions.

use std::path::Path;

use rust_xlsxwriter::{Format, FormatAlign, FormatBorder, Workbook, XlsxError};

use crate::checks::codes_in_rendered;
use crate::fixed::FixedIndex;
use crate::scan::{ranked_counts, CodeCounts};
use crate::spool::Row;

/// Excel's hard limit, header row included.
const XLSX_MAX_ROWS: u32 = 1_048_576;
/// Usable data rows per sheet, after the header.
pub const MAX_DATA_ROWS: u32 = XLSX_MAX_ROWS - 1;

/// Run facts shown on the Summary sheet.
pub struct RunInfo {
    pub root: String,
    pub started_at: String,
    pub finished_at: String,
    pub duration: String,
    pub threads: usize,
    pub filters: String,
    pub artists: u64,
    pub folders: u64,
    pub files: u64,
    pub problem_files: u64,
    pub problem_instances: u64,
    pub unreadable: u64,
    pub panicked: u64,
    pub panic_strategy: &'static str,
}

fn header_format() -> Format {
    Format::new()
        .set_bold()
        .set_background_color("4472C4")
        .set_font_color("FFFFFF")
        .set_align(FormatAlign::Center)
        .set_border(FormatBorder::Thin)
}

fn title_format() -> Format {
    Format::new().set_bold().set_font_size(13)
}

fn label_format() -> Format {
    Format::new().set_bold()
}

/// Marks a row `--fix:*` has already resolved. Same shade a manual OOXML patch used before this
/// became a native part of report generation.
fn fixed_format() -> Format {
    Format::new().set_background_color("C6EFCE")
}

/// Write the whole report.
///
/// `rows` is an iterator so the caller can stream straight from the spool without materialising
/// millions of rows in memory.
pub fn write_report(
    output: &Path,
    rows: impl Iterator<Item = Row>,
    counts: &CodeCounts,
    info: &RunInfo,
    fixed: &FixedIndex,
) -> Result<ReportStats, XlsxError> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let mut workbook = Workbook::new();

    // Created first so it is the leftmost tab; populated at the end.
    let summary_index = 0usize;
    workbook.add_worksheet().set_name("Summary")?;

    let mut writer = SheetWriter::new(&mut workbook)?;
    for row in rows {
        writer.write_row(&row, fixed)?;
    }
    let stats = writer.finish()?;

    write_summary(&mut workbook, summary_index, counts, info, &stats, fixed)?;
    workbook.save(output)?;
    Ok(stats)
}

pub struct ReportStats {
    pub rows_written: u64,
    pub sheets_used: usize,
    /// True when the row cap forced a rollover - worth saying out loud in the summary.
    pub rolled_over: bool,
}

struct SheetWriter<'a> {
    workbook: &'a mut Workbook,
    sheet_index: usize,
    rows_in_sheet: u32,
    sheet_number: usize,
    total_rows: u64,
    header_fmt: Format,
    fixed_fmt: Format,
}

impl<'a> SheetWriter<'a> {
    fn new(workbook: &'a mut Workbook) -> Result<Self, XlsxError> {
        let mut me = Self {
            workbook,
            sheet_index: 0,
            rows_in_sheet: 0,
            sheet_number: 0,
            total_rows: 0,
            header_fmt: header_format(),
            fixed_fmt: fixed_format(),
        };
        me.new_sheet()?;
        Ok(me)
    }

    fn new_sheet(&mut self) -> Result<(), XlsxError> {
        self.sheet_number += 1;
        let name = if self.sheet_number == 1 {
            "Problems".to_string()
        } else {
            format!("Problems ({})", self.sheet_number)
        };

        let ws = self.workbook.add_worksheet_with_constant_memory();
        ws.set_name(&name)?;
        ws.write_string_with_format(0, 0, "path", &self.header_fmt)?;
        ws.write_string_with_format(0, 1, "file", &self.header_fmt)?;
        ws.write_string_with_format(0, 2, "reason", &self.header_fmt)?;
        ws.set_column_width(0, 70)?;
        ws.set_column_width(1, 45)?;
        ws.set_column_width(2, 120)?;
        ws.set_freeze_panes(1, 0)?;

        self.sheet_index = self.workbook.worksheets().len() - 1;
        self.rows_in_sheet = 0;
        Ok(())
    }

    fn write_row(&mut self, row: &Row, fixed: &FixedIndex) -> Result<(), XlsxError> {
        if self.rows_in_sheet >= MAX_DATA_ROWS {
            self.finalize_current()?;
            self.new_sheet()?;
        }
        let r = self.rows_in_sheet + 1; // +1 for the header
        let idx = self.sheet_index;
        let ws = &mut self.workbook.worksheets_mut()[idx];

        if row_is_fixed(row, fixed) {
            ws.write_string_with_format(r, 0, &row.path, &self.fixed_fmt)?;
            ws.write_string_with_format(r, 1, &row.file, &self.fixed_fmt)?;
            ws.write_string_with_format(r, 2, &row.reason, &self.fixed_fmt)?;
        } else {
            ws.write_string(r, 0, &row.path)?;
            ws.write_string(r, 1, &row.file)?;
            ws.write_string(r, 2, &row.reason)?;
        }
        self.rows_in_sheet += 1;
        self.total_rows += 1;
        Ok(())
    }

    fn finalize_current(&mut self) -> Result<(), XlsxError> {
        let idx = self.sheet_index;
        let last = self.rows_in_sheet;
        let ws = &mut self.workbook.worksheets_mut()[idx];
        // Autofilter over the used range. Applied after the rows because it is a sheet-level
        // property and needs the final extent.
        ws.autofilter(0, 0, last.max(1), 2)?;
        Ok(())
    }

    fn finish(mut self) -> Result<ReportStats, XlsxError> {
        self.finalize_current()?;
        Ok(ReportStats {
            rows_written: self.total_rows,
            sheets_used: self.sheet_number,
            rolled_over: self.sheet_number > 1,
        })
    }
}

/// Whether a row's `--fix:*` history covers at least one of the defects it currently lists. Pulled
/// out of `write_row` so the decision is directly testable without going through
/// `rust_xlsxwriter`, which has no cell-format readback API.
fn row_is_fixed(row: &Row, fixed: &FixedIndex) -> bool {
    // On an ordinary run (no ledger yet) this never even runs `codes_in_rendered`, which matters at
    // full-library scale - one substring scan per row otherwise.
    !fixed.is_empty() && fixed.contains_any(&row.path, &row.file, &codes_in_rendered(&row.reason))
}

fn write_summary(
    workbook: &mut Workbook,
    index: usize,
    counts: &CodeCounts,
    info: &RunInfo,
    stats: &ReportStats,
    fixed: &FixedIndex,
) -> Result<(), XlsxError> {
    let header_fmt = header_format();
    let title_fmt = title_format();
    let label_fmt = label_format();
    let ws = &mut workbook.worksheets_mut()[index];

    ws.set_column_width(0, 26)?;
    ws.set_column_width(1, 60)?;
    ws.set_column_width(2, 90)?;
    ws.set_column_width(3, 16)?;
    ws.set_column_width(4, 12)?;
    ws.set_column_width(5, 12)?;
    ws.set_column_width(6, 12)?;

    let mut r = 0u32;
    ws.write_string_with_format(r, 0, "DMP tag problem scan", &title_fmt)?;
    r += 2;

    let kv = |ws: &mut rust_xlsxwriter::Worksheet,
              row: &mut u32,
              k: &str,
              v: &str|
     -> Result<(), XlsxError> {
        ws.write_string_with_format(*row, 0, k, &label_fmt)?;
        ws.write_string(*row, 1, v)?;
        *row += 1;
        Ok(())
    };

    kv(ws, &mut r, "Scan root", &info.root)?;
    kv(ws, &mut r, "Started", &info.started_at)?;
    kv(ws, &mut r, "Finished", &info.finished_at)?;
    kv(ws, &mut r, "Duration", &info.duration)?;
    kv(ws, &mut r, "Threads", &info.threads.to_string())?;
    kv(ws, &mut r, "Filters", &info.filters)?;
    kv(ws, &mut r, "Panic strategy", info.panic_strategy)?;
    r += 1;

    kv(ws, &mut r, "Artists scanned", &info.artists.to_string())?;
    kv(ws, &mut r, "Release folders", &info.folders.to_string())?;
    kv(ws, &mut r, "Files scanned", &info.files.to_string())?;
    kv(
        ws,
        &mut r,
        "Files with problems",
        &info.problem_files.to_string(),
    )?;
    kv(
        ws,
        &mut r,
        "Problem instances",
        &info.problem_instances.to_string(),
    )?;
    kv(ws, &mut r, "Unreadable files", &info.unreadable.to_string())?;
    kv(ws, &mut r, "Parser panics", &info.panicked.to_string())?;
    kv(ws, &mut r, "Rows written", &stats.rows_written.to_string())?;
    kv(ws, &mut r, "Problem sheets", &stats.sheets_used.to_string())?;
    if stats.rolled_over {
        kv(
            ws,
            &mut r,
            "Note",
            "Row cap reached - problems continue on the additional Problems sheets",
        )?;
    }
    kv(
        ws,
        &mut r,
        "Known limitation",
        "MP3s with unsynchronised ID3v2 tags are not re-read for raw date frames, so a malformed year in one of those may be under-reported",
    )?;
    r += 2;

    ws.write_string_with_format(r, 0, "Severity", &header_fmt)?;
    ws.write_string_with_format(r, 1, "Code", &header_fmt)?;
    ws.write_string_with_format(r, 2, "What it breaks", &header_fmt)?;
    ws.write_string_with_format(r, 3, "Files affected", &header_fmt)?;
    ws.write_string_with_format(r, 4, "Fixed", &header_fmt)?;
    ws.write_string_with_format(r, 5, "Remaining", &header_fmt)?;
    ws.write_string_with_format(r, 6, "% of files", &header_fmt)?;
    let table_header = r;
    r += 1;

    for (code, n) in ranked_counts(counts) {
        let pct = if info.files > 0 {
            (n as f64 / info.files as f64) * 100.0
        } else {
            0.0
        };
        let fixed_n = fixed.count_for(code);
        ws.write_string(r, 0, code.severity().label())?;
        ws.write_string(r, 1, code.code())?;
        ws.write_string(r, 2, code.message())?;
        ws.write_number(r, 3, n as f64)?;
        ws.write_number(r, 4, fixed_n as f64)?;
        ws.write_number(r, 5, n.saturating_sub(fixed_n) as f64)?;
        ws.write_string(r, 6, format!("{pct:.2}%"))?;
        r += 1;
    }

    if r > table_header + 1 {
        ws.autofilter(table_header, 0, r - 1, 6)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checks::ReasonCode;
    use crate::fixed::{self, FixOutcome};
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_path(tag: &str) -> std::path::PathBuf {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "problems-report-{}-{}-{}.xlsx",
            std::process::id(),
            tag,
            SEQ.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn temp_ledger_path(tag: &str) -> std::path::PathBuf {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "problems-report-{}-{}-{}.fixed.jsonl",
            std::process::id(),
            tag,
            SEQ.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn no_fixes() -> FixedIndex {
        FixedIndex::load(&temp_path("no-fixes-nonexistent"))
    }

    fn info(files: u64) -> RunInfo {
        RunInfo {
            root: "/music".into(),
            started_at: "now".into(),
            finished_at: "later".into(),
            duration: "1s".into(),
            threads: 4,
            filters: "none".into(),
            artists: 1,
            folders: 1,
            files,
            problem_files: files,
            problem_instances: files,
            unreadable: 0,
            panicked: 0,
            panic_strategy: "unwind",
        }
    }

    fn row(n: usize) -> Row {
        Row {
            path: format!("Artist/Album {n}"),
            file: format!("{n:02}.mp3"),
            reason: "CRITICAL: artist tag is missing".into(),
        }
    }

    #[test]
    fn writes_a_readable_workbook() {
        let path = temp_path("basic");
        let mut counts = CodeCounts::new();
        counts.insert(ReasonCode::ArtistMissing, 2);
        let rows = vec![row(1), row(2)];
        let stats = write_report(&path, rows.into_iter(), &counts, &info(2), &no_fixes())
            .expect("write report");
        assert_eq!(stats.rows_written, 2);
        assert_eq!(stats.sheets_used, 1);
        assert!(!stats.rolled_over);
        let size = std::fs::metadata(&path).expect("stat").len();
        assert!(size > 0, "workbook is empty");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn an_empty_report_still_produces_a_valid_workbook() {
        // A clean library is a legitimate outcome and must not produce a corrupt file.
        let path = temp_path("empty");
        let stats = write_report(
            &path,
            std::iter::empty(),
            &CodeCounts::new(),
            &info(0),
            &no_fixes(),
        )
        .expect("write empty report");
        assert_eq!(stats.rows_written, 0);
        assert!(std::fs::metadata(&path).expect("stat").len() > 0);
        std::fs::remove_file(&path).ok();
    }

    fn year_zero_row(path: &str, file: &str) -> Row {
        Row {
            path: path.into(),
            file: file.into(),
            reason: crate::checks::Reason::new(ReasonCode::YearZero, "0000").render(),
        }
    }

    #[test]
    fn row_is_fixed_matches_a_ledger_entry_for_the_same_file_and_code() {
        let ledger = temp_ledger_path("row-is-fixed");
        fixed::append(
            &ledger,
            &[FixOutcome {
                path: "Artist/Album 1".into(),
                file: "01.mp3".into(),
                code: ReasonCode::YearZero,
                action: "cleared".into(),
                field: "RecordingDate".into(),
                old_value: "0000".into(),
                new_value: None,
                fix_kind: "years".into(),
                detail: serde_json::Value::Null,
                fixed_at: "now".into(),
            }],
        )
        .expect("append");
        let idx = FixedIndex::load(&ledger);

        assert!(row_is_fixed(&year_zero_row("Artist/Album 1", "01.mp3"), &idx));
        // Same folder, different file - the ledger is keyed per file, not per release.
        assert!(!row_is_fixed(&year_zero_row("Artist/Album 1", "02.mp3"), &idx));
        // An ordinary (non-year) row is never fixed by a years-ledger entry.
        assert!(!row_is_fixed(&row(1), &no_fixes()));
        std::fs::remove_file(&ledger).ok();
    }

    #[test]
    fn a_fixed_row_still_produces_a_valid_workbook() {
        // Smoke test for the write_row/fixed-format integration itself - row_is_fixed above covers
        // the actual decision logic; rust_xlsxwriter has no cell-format readback API to assert the
        // green style landed on the right cells.
        let ledger = temp_ledger_path("smoke");
        fixed::append(
            &ledger,
            &[FixOutcome {
                path: "Artist/Album 1".into(),
                file: "01.mp3".into(),
                code: ReasonCode::YearZero,
                action: "cleared".into(),
                field: "RecordingDate".into(),
                old_value: "0000".into(),
                new_value: None,
                fix_kind: "years".into(),
                detail: serde_json::Value::Null,
                fixed_at: "now".into(),
            }],
        )
        .expect("append");
        let idx = FixedIndex::load(&ledger);

        let path = temp_path("fixed-smoke");
        let mut counts = CodeCounts::new();
        counts.insert(ReasonCode::YearZero, 1);
        let rows = vec![year_zero_row("Artist/Album 1", "01.mp3")];
        write_report(&path, rows.into_iter(), &counts, &info(1), &idx).expect("write report");
        assert!(std::fs::metadata(&path).expect("stat").len() > 0);
        std::fs::remove_file(&path).ok();
        std::fs::remove_file(&ledger).ok();
    }

    #[test]
    fn summary_fixed_column_counts_distinct_files_per_code() {
        let ledger = temp_ledger_path("counts");
        fixed::append(
            &ledger,
            &[
                FixOutcome {
                    path: "A".into(),
                    file: "1.mp3".into(),
                    code: ReasonCode::YearZero,
                    action: "set".into(),
                    field: "RecordingDate".into(),
                    old_value: "0000".into(),
                    new_value: Some("1990".into()),
                    fix_kind: "years".into(),
                    detail: serde_json::Value::Null,
                    fixed_at: "now".into(),
                },
                FixOutcome {
                    path: "B".into(),
                    file: "2.mp3".into(),
                    code: ReasonCode::YearZero,
                    action: "cleared".into(),
                    field: "Year".into(),
                    old_value: "xxxx".into(),
                    new_value: None,
                    fix_kind: "years".into(),
                    detail: serde_json::Value::Null,
                    fixed_at: "now".into(),
                },
            ],
        )
        .expect("append");
        let idx = FixedIndex::load(&ledger);
        assert_eq!(idx.count_for(ReasonCode::YearZero), 2);
        assert_eq!(idx.count_for(ReasonCode::YearNonNumeric), 0);
        std::fs::remove_file(&ledger).ok();
    }

    /// The rollover branch is unreachable in any test-sized run and only fires hours into the real
    /// one, so it is exercised here directly against the writer with a tiny synthetic cap.
    #[test]
    fn sheets_roll_over_when_the_row_cap_is_reached() {
        let path = temp_path("rollover");
        let mut workbook = Workbook::new();
        workbook
            .add_worksheet()
            .set_name("Summary")
            .expect("summary");

        const CAP: u32 = 10;
        let mut writer = SheetWriter::new(&mut workbook).expect("writer");
        for i in 0..25 {
            if writer.rows_in_sheet >= CAP {
                writer.finalize_current().expect("finalize");
                writer.new_sheet().expect("new sheet");
            }
            writer.write_row(&row(i), &no_fixes()).expect("write");
        }
        let stats = writer.finish().expect("finish");
        assert_eq!(stats.rows_written, 25);
        assert_eq!(
            stats.sheets_used, 3,
            "25 rows at 10/sheet should need 3 sheets"
        );
        assert!(stats.rolled_over);

        let names: Vec<String> = workbook
            .worksheets()
            .iter()
            .map(|w| w.name().to_string())
            .collect();
        assert_eq!(
            names,
            vec!["Summary", "Problems", "Problems (2)", "Problems (3)"]
        );

        workbook.save(&path).expect("save");
        assert!(std::fs::metadata(&path).expect("stat").len() > 0);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn the_data_row_cap_leaves_room_for_the_header() {
        assert_eq!(MAX_DATA_ROWS, XLSX_MAX_ROWS - 1);
    }
}
