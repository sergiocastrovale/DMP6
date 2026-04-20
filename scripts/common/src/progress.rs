use serde_json::Value as JsonValue;

pub fn emit_progress(data: &JsonValue) {
    println!("PROGRESS:{}", data);
}

pub fn index_progress(
    folder: &str,
    current: usize,
    total: usize,
    new: u64,
    updated: u64,
    skipped: u64,
    deleted: u64,
) {
    emit_progress(&serde_json::json!({
        "type": "index",
        "folder": folder,
        "current": current,
        "total": total,
        "new": new,
        "updated": updated,
        "skipped": skipped,
        "deleted": deleted,
    }));
}

pub fn sync_progress(artist: &str, current: usize, total: usize, status: &str) {
    emit_progress(&serde_json::json!({
        "type": "sync",
        "artist": artist,
        "current": current,
        "total": total,
        "status": status,
    }));
}
