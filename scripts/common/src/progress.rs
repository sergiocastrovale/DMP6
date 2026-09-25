use crate::error_log;
use colored::Colorize;
use serde_json::Value as JsonValue;
use std::sync::Arc;

/// Reports script activity with one visual grammar shared by every binary: a bold header + rule,
/// `[i/N] Name` items, `→`/`✓`/`↷`/`!`/`✗` lines indented 2 spaces per nesting level. Console and
/// `--web` render identically - `--web` additionally emits `PROGRESS:{json}` lines for the web UI's
/// structured progress bar (`index_progress`/`sync_progress`/`tidy_progress`, a schema contract with
/// `web/helpers/functions.ts`).
#[derive(Clone)]
pub struct Reporter {
    web: bool,
    depth: usize,
    /// Set by `for_artist` on a reporter handed to one concurrently-processed item, so several
    /// workers' interleaved output can still be told apart. `None` on every sequential binary.
    prefix: Option<Arc<str>>,
}

impl Reporter {
    pub fn new(web: bool) -> Self {
        Self {
            web,
            depth: 0,
            prefix: None,
        }
    }

    /// A reporter one nesting level deeper - every line it prints indents another 2 spaces. Structural
    /// calls (`header`/`section`/`item`/`done`/`failed`) ignore depth; they only ever sit at column 0.
    pub fn nested(&self) -> Self {
        Self {
            web: self.web,
            depth: self.depth + 1,
            prefix: self.prefix.clone(),
        }
    }

    /// A reporter scoped to one concurrently-processed artist: every line it emits, at any depth,
    /// carries `[name] ` first. Used only by the binaries that process several artists at once
    /// (`sync`, `artist-photos`) - a sequential binary never needs this, its `item` line already says
    /// which artist is running.
    pub fn for_artist(&self, name: &str) -> Self {
        Self {
            web: self.web,
            depth: self.depth,
            prefix: Some(Arc::from(format!("[{name}] "))),
        }
    }

    fn prefix_str(&self) -> &str {
        self.prefix.as_deref().unwrap_or("")
    }

    fn indent(&self) -> String {
        "  ".repeat(self.depth)
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

    // ----- Structure: always column 0, ignores self.depth -----

    /// Script banner: bold title + a double rule the same width as the title.
    pub fn header(&self, title: &str) {
        println!("{}{}", self.prefix_str(), title.bright_cyan().bold());
        println!(
            "{}{}",
            self.prefix_str(),
            "═".repeat(title.chars().count()).bright_black()
        );
    }

    /// A named block within a run (e.g. "Box sets", "Summary"): a blank line, bold title, single
    /// rule. Lighter than `header` - a run has one header and any number of sections.
    pub fn section(&self, title: &str) {
        self.blank();
        println!("{}{}", self.prefix_str(), title.bold());
        println!(
            "{}{}",
            self.prefix_str(),
            "─".repeat(title.chars().count()).bright_black()
        );
    }

    pub fn kv(&self, key: &str, value: &str) {
        println!(
            "{}{}{:<14}: {}",
            self.prefix_str(),
            "  ".repeat(self.depth.max(1)),
            key,
            value.bright_white()
        );
    }

    pub fn blank(&self) {
        println!();
    }

    /// Top-level progress line for a numbered item (folder, artist, box group).
    pub fn item(&self, name: &str, current: usize, total: usize) {
        println!(
            "{}{} {}",
            self.prefix_str(),
            format!("[{}/{}]", current, total).bright_black(),
            name.truecolor(130, 180, 255).bold(),
        );
    }

    // ----- Lines at self.depth -----

    /// Arrow-prefixed step announcement.
    pub fn step(&self, msg: &str) {
        println!(
            "{}{}{} {}",
            self.prefix_str(),
            self.indent(),
            "→".bright_black(),
            msg
        );
    }

    pub fn ok(&self, msg: &str) {
        println!(
            "{}{}{} {}",
            self.prefix_str(),
            self.indent(),
            "✓".green(),
            msg
        );
    }

    pub fn skip(&self, msg: &str) {
        println!(
            "{}{}{} {}",
            self.prefix_str(),
            self.indent(),
            "↷".truecolor(180, 160, 60),
            msg.bright_black()
        );
    }

    /// Logged to `errors.log` (with the `[artist]` prefix if scoped, no indent/glyph - the log is
    /// flat) as well as printed to stderr, since a lock-detection/monitor check on stderr is how the
    /// web app tells a run went wrong (`web/server/utils/monitorLoop.ts`).
    pub fn warn(&self, msg: &str) {
        error_log::log_warn(&format!("{}{}", self.prefix_str(), msg));
        eprintln!(
            "{}{}{} {}",
            self.prefix_str(),
            self.indent(),
            "!".yellow(),
            msg.yellow()
        );
    }

    pub fn err(&self, msg: &str) {
        error_log::log_error(&format!("{}{}", self.prefix_str(), msg));
        eprintln!(
            "{}{}{} {}",
            self.prefix_str(),
            self.indent(),
            "✗".red(),
            msg.bright_red()
        );
    }

    /// Transient in-place line (carriage-return), stderr only, never in web mode - no ANSI control
    /// codes in the web terminal, and the caller already builds the whole message (its own `[i/N]`
    /// counter), so no prefix/indent is added here.
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

    /// Plain message, no glyph, indented like `step`/`ok` (final summary lines, etc.).
    pub fn info(&self, msg: &str) {
        println!("{}{}{}", self.prefix_str(), self.indent(), msg);
    }

    /// The run's last line on success - `autoScan.ts` reads the log's final line as the summary, so
    /// callers must emit this (or `failed`) last, after every other line.
    pub fn done(&self, msg: &str) {
        println!(
            "{}{} {}",
            self.prefix_str(),
            "✓".green().bold(),
            msg.green().bold()
        );
    }

    /// The run's last line on failure - stderr, same reasoning as `done`.
    pub fn failed(&self, msg: &str) {
        eprintln!(
            "{}{} {}",
            self.prefix_str(),
            "✗".red().bold(),
            msg.red().bold()
        );
    }

    /// An inline confirmation prompt (no trailing newline, flushed immediately) - a destructive
    /// binary's `Type y to confirm:` before reading a line from stdin. The one legitimate case of
    /// needing output that isn't a whole line, so it stays a method here rather than an exception to
    /// the "everything routes through Reporter" rule the rest of `scripts/` follows.
    pub fn prompt(&self, msg: &str) {
        use std::io::Write;
        print!("{msg}");
        let _ = std::io::stdout().flush();
    }
}

/// Inline emphasis for building a message handed to `Reporter` (never a whole line by itself).
pub mod paint {
    use colored::{ColoredString, Colorize};

    pub fn accent(s: &str) -> ColoredString {
        s.cyan()
    }

    pub fn good(s: &str) -> ColoredString {
        s.green()
    }

    pub fn bad(s: &str) -> ColoredString {
        s.red()
    }

    pub fn dim(s: &str) -> ColoredString {
        s.bright_black()
    }

    pub fn strong(s: &str) -> ColoredString {
        s.bold()
    }
}

/// For the handful of places that run before a `Reporter` exists (`common::lock`/`app`/`config`/`db`,
/// a MusicBrainz client-level retry message) - same glyphs, column 0, no prefix/depth.
pub fn early_warn(msg: &str) {
    eprintln!("{} {}", "!".yellow(), msg.yellow());
}

pub fn early_err(msg: &str) {
    eprintln!("{} {}", "✗".red(), msg.bright_red());
}

/// A machine-readable protocol line that must stay byte-exact for its outside reader (mosaic's
/// `PROGRESS:{json}`/`DONE:{json}`, read by `web/server/api/labs/mosaic/generate.post.ts`) - printed
/// raw, bypassing every Reporter style rule.
pub fn protocol_line(line: &str) {
    println!("{line}");
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

    /// Strips ANSI escapes so assertions can check the plain text shape.
    fn plain(s: &str) -> String {
        let mut out = String::new();
        let mut chars = s.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                for c2 in chars.by_ref() {
                    if c2 == 'm' {
                        break;
                    }
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    #[test]
    fn nested_adds_two_spaces_per_level() {
        let r = Reporter::new(false);
        assert_eq!(plain(&format!("{}{}", r.indent(), "x")), "x");
        assert_eq!(plain(&format!("{}{}", r.nested().indent(), "x")), "  x");
        assert_eq!(
            plain(&format!("{}{}", r.nested().nested().indent(), "x")),
            "    x"
        );
    }

    #[test]
    fn for_artist_sets_a_bracketed_prefix_at_the_same_depth() {
        let r = Reporter::new(false).nested().for_artist("Radiohead");
        assert_eq!(r.prefix_str(), "[Radiohead] ");
        assert_eq!(r.depth, 1);
    }

    #[test]
    fn kv_indents_at_least_one_level_even_at_depth_zero() {
        let r = Reporter::new(false);
        assert_eq!(r.depth.max(1), 1);
    }
}
