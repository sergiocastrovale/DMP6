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
    UUID_RE.find(trimmed).map(|m| m.as_str().to_lowercase())
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
///   bogus matches against unrelated folders. Escape the input BEFORE appending any wildcard suffix.
pub fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
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
    fn normalize_filter_drops_punctuation_and_collapses_spaces() {
        assert_eq!(normalize_filter("A.A. Bondy"), "aa bondy");
        assert_eq!(normalize_filter("070-shake"), "070shake");
        assert_eq!(normalize_filter("  Sunn   O)))  "), "sunn o");
    }

    #[test]
    fn matches_filter_only_is_prefix_unless_exact_and_splits_on_semicolons() {
        assert!(matches_filter("Airbag", "", "", "air", false));
        assert!(!matches_filter("Airbag", "", "", "air", true));
        assert!(matches_filter("Air", "", "", "air", true));
        assert!(matches_filter("Björk", "", "", "radiohead; björk", false));
        assert!(!matches_filter("Blur", "", "", "radiohead;;", false));
    }

    #[test]
    fn matches_filter_range_is_inclusive_of_the_to_prefix() {
        assert!(matches_filter("Beck", "b", "c", "", false));
        assert!(matches_filter("Coldplay", "b", "c", "", false));
        assert!(!matches_filter("Abba", "b", "c", "", false));
        assert!(!matches_filter("Delta", "b", "c", "", false));
        assert!(matches_filter("Anything", "", "", "", false));
    }

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
