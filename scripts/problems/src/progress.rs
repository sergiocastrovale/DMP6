//! Single-line progress display.
//!
//! A dedicated printer thread on a fixed tick, rather than printing from the worker threads: with
//! 16 rayon workers all calling `eprint!`, the escape sequences interleave and the line becomes
//! unreadable. Workers only bump atomics.

use std::io::{IsTerminal, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct Counters {
    pub files: AtomicU64,
    pub folders: AtomicU64,
    pub problem_files: AtomicU64,
    pub problem_instances: AtomicU64,
    pub unreadable: AtomicU64,
    pub artists_done: AtomicU64,
}

pub struct Progress {
    label: Arc<Mutex<String>>,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    enabled: bool,
}

impl Progress {
    /// Spawn the printer.
    ///
    /// Auto-disables when stderr is not a terminal: a six-hour run redirected to a log file would
    /// otherwise write megabytes of carriage returns and clear-line escapes.
    pub fn start(counters: Arc<Counters>, total_artists: u64, force_off: bool) -> Self {
        let enabled = !force_off && std::io::stderr().is_terminal();
        let label = Arc::new(Mutex::new(String::new()));
        let stop = Arc::new(AtomicBool::new(false));

        let handle = enabled.then(|| {
            let (counters, label, stop) = (counters.clone(), label.clone(), stop.clone());
            std::thread::spawn(move || {
                let started = Instant::now();
                while !stop.load(Ordering::Relaxed) {
                    render(&counters, &label, total_artists, started);
                    std::thread::sleep(Duration::from_millis(250));
                }
            })
        });

        Self {
            label,
            stop,
            handle,
            enabled,
        }
    }

    pub fn set_label(&self, artist: &str) {
        if self.enabled {
            if let Ok(mut l) = self.label.lock() {
                l.clear();
                l.push_str(artist);
            }
        }
    }

    /// Stop the printer and clear the line so subsequent output starts clean.
    pub fn finish(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
        if self.enabled {
            eprint!("\r\x1b[K");
            let _ = std::io::stderr().flush();
        }
    }
}

fn render(counters: &Counters, label: &Mutex<String>, total_artists: u64, started: Instant) {
    let files = counters.files.load(Ordering::Relaxed);
    let problems = counters.problem_files.load(Ordering::Relaxed);
    let done = counters.artists_done.load(Ordering::Relaxed);
    let name = label.lock().map(|l| l.clone()).unwrap_or_default();

    let secs = started.elapsed().as_secs_f64().max(0.001);
    let rate = files as f64 / secs;
    let eta = eta_string(done, total_artists, started);

    // \r returns to column 0, \x1b[K clears to end of line - the same pair the other scripts use.
    eprint!(
        "\r\x1b[K  [{}/{}] {} | {} files | {} flagged | {:.0}/s | ETA {}",
        done,
        total_artists,
        truncate(&name, 40),
        files,
        problems,
        rate,
        eta
    );
    let _ = std::io::stderr().flush();
}

/// ETA from artists completed, not files: folder sizes vary so wildly that a file-based estimate
/// swings uselessly, whereas artist count is exactly what a resume restarts from.
fn eta_string(done: u64, total: u64, started: Instant) -> String {
    if done == 0 || total == 0 || done >= total {
        return "--".into();
    }
    let per = started.elapsed().as_secs_f64() / done as f64;
    format_duration(Duration::from_secs_f64(per * (total - done) as f64))
}

pub fn format_duration(d: Duration) -> String {
    let s = d.as_secs();
    if s >= 3600 {
        format!("{}h{:02}m", s / 3600, (s % 3600) / 60)
    } else if s >= 60 {
        format!("{}m{:02}s", s / 60, s % 60)
    } else {
        format!("{s}s")
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let kept: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{kept}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations_format_readably() {
        assert_eq!(format_duration(Duration::from_secs(5)), "5s");
        assert_eq!(format_duration(Duration::from_secs(65)), "1m05s");
        assert_eq!(format_duration(Duration::from_secs(3725)), "1h02m");
    }

    #[test]
    fn truncate_respects_char_boundaries() {
        assert_eq!(truncate("Radiohead", 40), "Radiohead");
        assert_eq!(truncate("abcdef", 3), "ab…");
        // Must not panic or split a multi-byte char.
        assert_eq!(truncate("日本語のバンド名", 3), "日本…");
    }

    #[test]
    fn eta_is_unknown_until_there_is_something_to_extrapolate_from() {
        let now = Instant::now();
        assert_eq!(eta_string(0, 100, now), "--");
        assert_eq!(eta_string(100, 100, now), "--");
        assert_eq!(eta_string(5, 0, now), "--");
    }

    #[test]
    fn a_disabled_progress_is_inert_and_joins_cleanly() {
        let c = Arc::new(Counters::default());
        let p = Progress::start(c.clone(), 10, true);
        p.set_label("Radiohead");
        c.files.fetch_add(5, Ordering::Relaxed);
        p.finish();
        assert_eq!(c.files.load(Ordering::Relaxed), 5);
    }
}
