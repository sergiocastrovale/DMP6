use chrono::Local;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::OnceLock;

static SCRIPT_NAME: OnceLock<String> = OnceLock::new();

pub fn init(name: &str) {
    let _ = SCRIPT_NAME.set(name.to_string());
}

fn append(level: &str, msg: &str) {
    let name = SCRIPT_NAME.get().map(|s| s.as_str()).unwrap_or("unknown");
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("({ts})[{name}] {level}: {msg}\n");

    let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("errors.log")
    else {
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
