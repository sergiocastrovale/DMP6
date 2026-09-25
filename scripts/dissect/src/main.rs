use clap::Parser;
use common::progress::Reporter;
use regex::Regex;
use rust_xlsxwriter::{Format, FormatAlign, FormatBorder, Workbook};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    name = "dissect",
    about = "Parse errors.log into a structured XLSX report"
)]
struct Args {
    /// Path to errors.log. Defaults to wherever every binary's own error_log actually writes it
    /// (PROJECT_ROOT-aware) rather than a bare relative "errors.log", which almost never matches in
    /// a deployed container.
    #[arg(long, short)]
    input: Option<String>,

    #[arg(
        long,
        short,
        default_value = "reports/errors.xlsx",
        help = "Output XLSX path"
    )]
    output: String,
}

#[derive(Debug, Clone, Hash, Eq, PartialEq, Ord, PartialOrd)]
enum ErrorType {
    NoArtistTag,
    CannotReadTags,
    DbError,
    Other,
}

impl ErrorType {
    fn sheet_name(&self) -> &str {
        match self {
            ErrorType::NoArtistTag => "No Artist Tag",
            ErrorType::CannotReadTags => "Cannot Read Tags",
            ErrorType::DbError => "DB Error",
            ErrorType::Other => "Other",
        }
    }

    fn description(&self) -> &str {
        match self {
            ErrorType::NoArtistTag => "Files missing the artist metadata tag",
            ErrorType::CannotReadTags => {
                "Files whose tags could not be parsed (corrupted/unsupported encoding)"
            }
            ErrorType::DbError => "Database errors during indexing (e.g. value too long)",
            ErrorType::Other => "Unclassified warnings or errors",
        }
    }
}

#[derive(Debug)]
struct ParsedError {
    error_type: ErrorType,
    artist: String,
    path: String,
    detail: String,
    timestamp: String,
    raw_message: String,
}

fn extract_path_parts(file_path: &str) -> (String, String) {
    let stripped = file_path.strip_prefix("/music/").unwrap_or(file_path);
    let segments: Vec<&str> = stripped.splitn(2, '/').collect();
    let artist = segments.first().unwrap_or(&"").to_string();
    let rest = segments.get(1).unwrap_or(&"").to_string();
    let folder = rest.rsplitn(2, '/').last().unwrap_or("").to_string();
    (artist, folder)
}

fn parse_line(line: &str, line_re: &Regex) -> Option<ParsedError> {
    let caps = line_re.captures(line)?;
    let timestamp = caps.get(1)?.as_str().to_string();
    let message = caps.get(4)?.as_str();

    if let Some(path) = message.strip_prefix("no artist tag: ") {
        let (artist, folder) = extract_path_parts(path.trim());
        return Some(ParsedError {
            error_type: ErrorType::NoArtistTag,
            artist,
            path: folder,
            detail: String::new(),
            timestamp,
            raw_message: String::new(),
        });
    }

    if let Some(pos) = message.find(": cannot read tags: ") {
        let file_path = &message[..pos];
        let reason = &message[pos + ": cannot read tags: ".len()..];
        let (artist, folder) = extract_path_parts(file_path.trim());
        return Some(ParsedError {
            error_type: ErrorType::CannotReadTags,
            artist,
            path: folder,
            detail: reason.to_string(),
            timestamp,
            raw_message: String::new(),
        });
    }

    if message.starts_with("DB error") {
        let detail = if let Some(pos) = message.rfind("): ") {
            message[pos + 3..].to_string()
        } else {
            message.to_string()
        };

        return Some(ParsedError {
            error_type: ErrorType::DbError,
            artist: String::new(),
            path: String::new(),
            detail,
            timestamp,
            raw_message: message.to_string(),
        });
    }

    if message.contains("/music/") {
        let path_start = message.find("/music/").unwrap();
        let path_end = message[path_start..]
            .find(": ")
            .map(|p| path_start + p)
            .unwrap_or(message.len());
        let file_path = &message[path_start..path_end];
        let (artist, folder) = extract_path_parts(file_path);
        let detail = if path_end < message.len() {
            message[path_end + 2..].to_string()
        } else {
            String::new()
        };
        return Some(ParsedError {
            error_type: ErrorType::Other,
            artist,
            path: folder,
            detail,
            timestamp,
            raw_message: String::new(),
        });
    }

    Some(ParsedError {
        error_type: ErrorType::Other,
        artist: String::new(),
        path: String::new(),
        detail: message.to_string(),
        timestamp,
        raw_message: String::new(),
    })
}

type GroupKey = (ErrorType, String, String, String);

fn main() {
    let args = Args::parse();
    common::error_log::init("dissect");
    let reporter = Reporter::new(false);
    let input = args.input.unwrap_or_else(|| {
        common::error_log::default_log_path()
            .to_string_lossy()
            .into_owned()
    });

    reporter.header("DMP Dissect");
    reporter.kv("Input", &input);
    reporter.kv("Output", &args.output);
    reporter.blank();

    let content = match fs::read_to_string(&input) {
        Ok(c) => c,
        Err(e) => {
            reporter.failed(&format!("Cannot read '{}': {}", input, e));
            std::process::exit(1);
        }
    };

    let line_re =
        Regex::new(r"^\((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\)\[(\w+)\] (WARN|ERROR): (.+)$")
            .unwrap();

    let mut groups: HashMap<GroupKey, u64> = HashMap::new();
    let mut db_errors: Vec<(String, String, String)> = Vec::new();
    let mut unparsed = 0u64;
    let mut total_lines = 0u64;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        total_lines += 1;

        if let Some(parsed) = parse_line(line, &line_re) {
            if parsed.error_type == ErrorType::DbError {
                db_errors.push((parsed.timestamp, parsed.raw_message, parsed.detail));
            } else {
                let key = (parsed.error_type, parsed.artist, parsed.path, parsed.detail);
                *groups.entry(key).or_insert(0) += 1;
            }
        } else {
            unparsed += 1;
        }
    }

    let mut by_type: BTreeMap<ErrorType, Vec<(String, String, String, u64)>> = BTreeMap::new();
    for ((error_type, artist, path, detail), count) in &groups {
        by_type.entry(error_type.clone()).or_default().push((
            artist.clone(),
            path.clone(),
            detail.clone(),
            *count,
        ));
    }
    for rows in by_type.values_mut() {
        rows.sort_by(|a, b| {
            a.0.to_lowercase()
                .cmp(&b.0.to_lowercase())
                .then(a.1.cmp(&b.1))
                .then(a.2.cmp(&b.2))
        });
    }

    reporter.kv("Parsed", &format!("{} lines", total_lines));
    if unparsed > 0 {
        reporter.kv("Skipped", &format!("{} unparseable lines", unparsed));
    }
    reporter.blank();

    for (error_type, rows) in &by_type {
        let total_errors: u64 = rows.iter().map(|(_, _, _, c)| c).sum();
        reporter.info(&format!(
            "{}: {} errors across {} folders",
            error_type.sheet_name(),
            total_errors,
            rows.len()
        ));
    }
    if !db_errors.is_empty() {
        reporter.info(&format!(
            "DB Error: {} errors (individual rows)",
            db_errors.len()
        ));
    }
    reporter.blank();

    if let Some(parent) = PathBuf::from(&args.output).parent() {
        fs::create_dir_all(parent).ok();
    }

    let mut workbook = Workbook::new();

    let header_fmt = Format::new()
        .set_bold()
        .set_background_color("4472C4")
        .set_font_color("FFFFFF")
        .set_align(FormatAlign::Center)
        .set_border(FormatBorder::Thin);

    let cell_fmt = Format::new().set_border(FormatBorder::Thin);
    let num_fmt = Format::new()
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);

    let legend = workbook.add_worksheet();
    legend.set_name("Legend").ok();

    let legend_headers = [
        "Error Type",
        "Sheet Name",
        "Description",
        "Total Errors",
        "Total Folders",
    ];
    for (col, header) in legend_headers.iter().enumerate() {
        legend
            .write_string_with_format(0, col as u16, *header, &header_fmt)
            .ok();
    }
    legend.set_column_width(0, 20).ok();
    legend.set_column_width(1, 20).ok();
    legend.set_column_width(2, 70).ok();
    legend.set_column_width(3, 14).ok();
    legend.set_column_width(4, 14).ok();

    let mut legend_row = 1u32;
    for (error_type, rows) in &by_type {
        let total_errors: u64 = rows.iter().map(|(_, _, _, c)| c).sum();
        legend
            .write_string_with_format(legend_row, 0, error_type.sheet_name(), &cell_fmt)
            .ok();
        legend
            .write_string_with_format(legend_row, 1, error_type.sheet_name(), &cell_fmt)
            .ok();
        legend
            .write_string_with_format(legend_row, 2, error_type.description(), &cell_fmt)
            .ok();
        legend
            .write_number_with_format(legend_row, 3, total_errors as f64, &num_fmt)
            .ok();
        legend
            .write_number_with_format(legend_row, 4, rows.len() as f64, &num_fmt)
            .ok();
        legend_row += 1;
    }
    if !db_errors.is_empty() {
        legend
            .write_string_with_format(legend_row, 0, ErrorType::DbError.sheet_name(), &cell_fmt)
            .ok();
        legend
            .write_string_with_format(legend_row, 1, ErrorType::DbError.sheet_name(), &cell_fmt)
            .ok();
        legend
            .write_string_with_format(legend_row, 2, ErrorType::DbError.description(), &cell_fmt)
            .ok();
        legend
            .write_number_with_format(legend_row, 3, db_errors.len() as f64, &num_fmt)
            .ok();
        legend
            .write_string_with_format(legend_row, 4, "-", &num_fmt)
            .ok();
    }

    for (error_type, rows) in &by_type {
        let sheet = workbook.add_worksheet();
        sheet.set_name(error_type.sheet_name()).ok();

        let has_detail = rows.iter().any(|(_, _, d, _)| !d.is_empty());
        let headers: Vec<&str> = if has_detail {
            vec!["Artist", "Path", "No. Errors", "Detail"]
        } else {
            vec!["Artist", "Path", "No. Errors"]
        };

        for (col, header) in headers.iter().enumerate() {
            sheet
                .write_string_with_format(0, col as u16, *header, &header_fmt)
                .ok();
        }
        sheet.set_column_width(0, 30).ok();
        sheet.set_column_width(1, 60).ok();
        sheet.set_column_width(2, 12).ok();
        if has_detail {
            sheet.set_column_width(3, 50).ok();
        }

        for (i, (artist, path, detail, count)) in rows.iter().enumerate() {
            let row = (i + 1) as u32;
            sheet
                .write_string_with_format(row, 0, artist, &cell_fmt)
                .ok();
            sheet.write_string_with_format(row, 1, path, &cell_fmt).ok();
            sheet
                .write_number_with_format(row, 2, *count as f64, &num_fmt)
                .ok();
            if has_detail {
                sheet
                    .write_string_with_format(row, 3, detail, &cell_fmt)
                    .ok();
            }
        }

        sheet
            .autofilter(0, 0, rows.len() as u32, headers.len() as u16 - 1)
            .ok();
    }

    if !db_errors.is_empty() {
        let sheet = workbook.add_worksheet();
        sheet.set_name("DB Error").ok();

        let headers = ["Timestamp", "Message", "Detail"];
        for (col, header) in headers.iter().enumerate() {
            sheet
                .write_string_with_format(0, col as u16, *header, &header_fmt)
                .ok();
        }
        sheet.set_column_width(0, 20).ok();
        sheet.set_column_width(1, 80).ok();
        sheet.set_column_width(2, 60).ok();

        for (i, (ts, msg, detail)) in db_errors.iter().enumerate() {
            let row = (i + 1) as u32;
            sheet.write_string_with_format(row, 0, ts, &cell_fmt).ok();
            sheet.write_string_with_format(row, 1, msg, &cell_fmt).ok();
            sheet
                .write_string_with_format(row, 2, detail, &cell_fmt)
                .ok();
        }

        sheet.autofilter(0, 0, db_errors.len() as u32, 2).ok();
    }

    match workbook.save(&args.output) {
        Ok(_) => {
            reporter.done(&format!("Saved to {}", args.output));
        }
        Err(e) => {
            reporter.failed(&format!("Failed to write XLSX: {}", e));
            std::process::exit(1);
        }
    }
}
