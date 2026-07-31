use chrono::Local;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static SCRIPT_NAME: OnceLock<String> = OnceLock::new();

const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024; // 10MB, then rotate to errors.log.1

pub fn init(name: &str) {
    let _ = SCRIPT_NAME.set(name.to_string());
}

// Under the mounted data dir when PROJECT_ROOT is set (container: /app -> /app/data/logs, the same
// volume monitor.log uses on the web side) - falls back to CWD-relative for standalone/dev CLI runs
// with no PROJECT_ROOT, same as before.
fn log_path() -> PathBuf {
    match std::env::var("PROJECT_ROOT") {
        Ok(root) => PathBuf::from(root).join("data").join("logs").join("errors.log"),
        Err(_) => PathBuf::from("errors.log"),
    }
}

fn append(level: &str, msg: &str) {
    let name = SCRIPT_NAME.get().map(|s| s.as_str()).unwrap_or("unknown");
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("({ts})[{name}] {level}: {msg}\n");

    let path = log_path();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::metadata(&path).map(|m| m.len()).unwrap_or(0) >= MAX_LOG_BYTES {
        let _ = fs::rename(&path, path.with_extension("log.1"));
    }

    let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };
    let _ = f.write_all(line.as_bytes());
}

pub fn log_warn(msg: &str) {
    append("WARN", msg);
}

pub fn log_error(msg: &str) {
    append("ERROR", msg);
}
