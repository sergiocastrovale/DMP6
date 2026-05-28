use regex::Regex;
use std::sync::LazyLock;

static UUID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap()
});

pub fn sanitize_mb_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    UUID_RE
        .find(trimmed)
        .map(|m| m.as_str().to_lowercase())
}

/// Normalize a name for filter comparison: lowercase, strip non-alphanumeric, collapse whitespace.
/// Ensures "A.A. Bondy" matches "AA Bondy", "070-shake" matches "070 Shake", etc.
pub fn normalize_filter(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

pub fn matches_filter(folder: &str, from: &str, to: &str, only: &str, exact: bool) -> bool {
    let folder_norm = normalize_filter(folder);

    if !only.is_empty() {
        return only.split(';').any(|part| {
            let part = part.trim();
            if part.is_empty() {
                return false;
            }
            let part_norm = normalize_filter(part);
            if exact {
                folder_norm == part_norm
            } else {
                folder_norm.starts_with(&part_norm)
            }
        });
    }

    if !from.is_empty() {
        let from_norm = normalize_filter(from);
        if folder_norm < from_norm {
            return false;
        }
    }
    if !to.is_empty() {
        let to_norm = normalize_filter(to);
        let to_upper = format!("{}\u{10FFFF}", to_norm);
        if folder_norm > to_upper {
            return false;
        }
    }

    true
}
