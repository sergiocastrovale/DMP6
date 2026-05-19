use colored::Colorize;
use serde_json::Value as JsonValue;
use crate::error_log;

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

    pub fn is_web(&self) -> bool {
        self.web
    }

    // ----- JSON emission (web mode only) -----

    fn emit_json(&self, data: &JsonValue) {
        if self.web {
            println!("PROGRESS:{}", data);
        }
    }

    pub fn index_progress(
        &self,
        folder: &str,
        current: usize,
        total: usize,
        new: u64,
        updated: u64,
        skipped: u64,
        deleted: u64,
    ) {
        self.emit_json(&serde_json::json!({
            "phase": "index",
            "folder": folder,
            "current": current,
            "total": total,
            "new": new,
            "updated": updated,
            "skipped": skipped,
            "deleted": deleted,
        }));
    }

    pub fn sync_progress(&self, artist: &str, current: usize, total: usize, status: &str) {
        self.emit_json(&serde_json::json!({
            "phase": "sync",
            "artist": artist,
            "current": current,
            "total": total,
            "status": status,
        }));
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

    /// Sub-heading under an item (e.g. "Goo Goo Dolls" inside a folder).
    pub fn sub_item(&self, name: &str) {
        if self.web {
            println!("  {}", name);
        } else {
            println!("  {}", name.bright_cyan().bold());
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

    /// Transient in-place line (carriage-return). No-op in web mode — we don't
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
