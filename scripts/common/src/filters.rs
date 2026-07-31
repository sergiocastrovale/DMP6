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

/// Escape `%`, `_`, and the escape character itself for a SQL LIKE pattern (Postgres defaults to `\`
/// as the LIKE escape char). Without this, a folder name containing `%` or `_` corrupts the pattern
/// - `_` matches any single char, `%` matches anything - e.g. "100% Silk" or "A_Tribute" would produce
/// bogus matches against unrelated folders. Escape the input BEFORE appending any wildcard suffix.
pub fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_like_escapes_percent_and_underscore() {
        assert_eq!(escape_like("100% Silk"), "100\\% Silk");
        assert_eq!(escape_like("A_Tribute"), "A\\_Tribute");
        assert_eq!(escape_like("100%_done"), "100\\%\\_done");
    }

    #[test]
    fn escape_like_escapes_backslash_first_so_it_is_not_double_escaped() {
        assert_eq!(escape_like("back\\slash"), "back\\\\slash");
    }

    #[test]
    fn escape_like_leaves_plain_names_untouched() {
        assert_eq!(escape_like("ACDC"), "ACDC");
        assert_eq!(escape_like("Boards of Canada"), "Boards of Canada");
    }
}
