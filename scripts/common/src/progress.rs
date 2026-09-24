use crate::error_log;
use colored::Colorize;
use serde_json::Value as JsonValue;

/// Reports script activity in one of two modes:
/// - **console** (default): human-friendly colored output with icons and indentation
/// - **web** (`--web` flag): `PROGRESS:{json}` lines consumed by the web UI,
///   plus a plain text mirror so the terminal panel still reads well
#[derive(Clone)]
pub struct Reporter {
    web: bool,
}

impl Reporter {
    pub fn new(web: bool) -> Self {
        Self { web }
    }

    // ----- JSON emission (web mode only) -----

    fn emit_json(&self, data: &JsonValue) {
        if self.web {
            println!("PROGRESS:{}", data);
        }
    }

    pub fn index_progress(&self, folder: &str, current: usize, total: usize, tally: FolderTally) {
        self.emit_json(&index_progress_json(folder, current, total, tally));
    }

    pub fn sync_progress(&self, artist: &str, current: usize, total: usize, status: &str) {
        self.emit_json(&sync_progress_json(artist, current, total, status));
    }

    /// `./tidy`'s own web-mode progress line - `step` names the current pipeline phase (e.g.
    /// "Re-scoring"), since tidy has no single "current item" the way index has a folder or sync an
    /// artist.
    pub fn tidy_progress(&self, step: &str, current: usize, total: usize) {
        self.emit_json(&tidy_progress_json(step, current, total));
    }

    // ----- Structural output (both modes) -----

    /// Script banner. Rendered as a colored header in console mode,
    /// a one-liner in web mode.
    pub fn header(&self, title: &str) {
        if self.web {
            println!("{}", title);
        } else {
            let bar = "=".repeat(title.len());
            println!("{}", title.bright_cyan().bold());
            println!("{}", bar.bright_black());
        }
    }

    pub fn kv(&self, key: &str, value: &str) {
        if self.web {
            println!("{}: {}", key, value);
        } else {
            println!("{:<14}: {}", key, value.bright_white());
        }
    }

    pub fn blank(&self) {
        println!();
    }

    /// Top-level progress line for a numbered item (folder, artist).
    pub fn item(&self, label: &str, name: &str, current: usize, total: usize) {
        if self.web {
            println!("[{}/{}] {} {}", current, total, label, name);
        } else {
            println!(
                "{} {} {}",
                format!("[{}/{}]", current, total).bright_black(),
                label,
                name.truecolor(130, 180, 255).bold(),
            );
        }
    }

    /// Arrow-prefixed step announcement.
    pub fn step(&self, msg: &str) {
        if self.web {
            println!("  - {}", msg);
        } else {
            println!("  {} {}", "→".bright_black(), msg);
        }
    }

    /// Arrow-prefixed nested step (deeper indent).
    pub fn sub_step(&self, msg: &str) {
        if self.web {
            println!("    - {}", msg);
        } else {
            println!("    {} {}", "→".bright_black(), msg);
        }
    }

    pub fn ok(&self, msg: &str) {
        if self.web {
            println!("    ok {}", msg);
        } else {
            println!("    {} {}", "✓".green(), msg);
        }
    }

    pub fn sub_ok(&self, msg: &str) {
        if self.web {
            println!("      ok {}", msg);
        } else {
            println!("      {} {}", "✓".green(), msg);
        }
    }

    pub fn warn(&self, msg: &str) {
        error_log::log_warn(msg);
        if self.web {
            eprintln!("    ! {}", msg);
        } else {
            eprintln!("    {} {}", "!".yellow(), msg.yellow());
        }
    }

    pub fn err(&self, msg: &str) {
        error_log::log_error(msg);
        if self.web {
            eprintln!("    x {}", msg);
        } else {
            eprintln!("    {} {}", "✗".red(), msg.bright_red());
        }
    }

    pub fn skip(&self, msg: &str) {
        if self.web {
            println!("    ~ {}", msg);
        } else {
            println!("    {} {}", "↷".truecolor(180, 160, 60), msg.bright_black());
        }
    }

    /// Transient in-place line (carriage-return). No-op in web mode - we don't
    /// want ANSI control codes in the web terminal, so we just skip it.
    pub fn transient(&self, msg: &str) {
        if !self.web {
            use std::io::Write;
            eprint!("\r\x1b[K      {}", msg);
            let _ = std::io::stderr().flush();
        }
    }

    /// Clears a transient line. No-op in web mode.
    pub fn clear_transient(&self) {
        if !self.web {
            eprint!("\r\x1b[K");
        }
    }

    /// Plain message with no icon (final summary lines, etc.).
    pub fn info(&self, msg: &str) {
        println!("{}", msg);
    }

    pub fn done(&self, msg: &str) {
        if self.web {
            println!("{}", msg);
        } else {
            println!("{}", msg.green().bold());
        }
    }
}

// The web UI parses these objects (`web/helpers/functions.ts`, `components/terminal/Progress.vue`):
// field names and value types are a contract.

#[allow(clippy::too_many_arguments)]
/// One folder's file-level outcome counts for the index progress line - travels as a unit since every
/// caller has all four at the same time (the folder loop's own running totals).
#[derive(Clone, Copy, Default)]
pub struct FolderTally {
    pub new: u64,
    pub updated: u64,
    pub skipped: u64,
    pub deleted: u64,
}

fn index_progress_json(
    folder: &str,
    current: usize,
    total: usize,
    tally: FolderTally,
) -> JsonValue {
    serde_json::json!({
        "phase": "index",
        "folder": folder,
        "current": current,
        "total": total,
        "new": tally.new,
        "updated": tally.updated,
        "skipped": tally.skipped,
        "deleted": tally.deleted,
    })
}

fn sync_progress_json(artist: &str, current: usize, total: usize, status: &str) -> JsonValue {
    serde_json::json!({
        "phase": "sync",
        "artist": artist,
        "current": current,
        "total": total,
        "status": status,
    })
}

fn tidy_progress_json(step: &str, current: usize, total: usize) -> JsonValue {
    serde_json::json!({
        "phase": "tidy",
        "step": step,
        "current": current,
        "total": total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_progress_contract() {
        assert_eq!(
            index_progress_json(
                "A/B",
                2,
                9,
                FolderTally {
                    new: 3,
                    updated: 4,
                    skipped: 5,
                    deleted: 6,
                }
            )
            .to_string(),
            r#"{"current":2,"deleted":6,"folder":"A/B","new":3,"phase":"index","skipped":5,"total":9,"updated":4}"#
        );
    }

    #[test]
    fn sync_progress_contract() {
        assert_eq!(
            sync_progress_json("Artist", 1, 7, "no_match").to_string(),
            r#"{"artist":"Artist","current":1,"phase":"sync","status":"no_match","total":7}"#
        );
    }

    #[test]
    fn tidy_progress_contract() {
        assert_eq!(
            tidy_progress_json("Re-scoring", 3, 10).to_string(),
            r#"{"current":3,"phase":"tidy","step":"Re-scoring","total":10}"#
        );
    }
}
