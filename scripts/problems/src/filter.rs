//! Artist-folder filtering, mirroring `scripts/common/src/filters.rs`.
//!
//! Copied rather than imported so this crate stays independent of `common`. Behaviour must match
//! the other scripts or `--only "Radiohead"` would select a different set here than for `./index`.

/// Lowercase and trim for case-insensitive prefix comparison.
pub fn normalize_filter(s: &str) -> String {
    s.trim().to_lowercase()
}

/// Does this folder name pass the from/to/only filters?
///
/// `from`/`to` are inclusive lexicographic bounds on the lowercased name; `only` is a prefix match,
/// or an exact match when `exact` is set.
pub fn matches_filter(name: &str, from: &str, to: &str, only: &str, exact: bool) -> bool {
    let n = normalize_filter(name);

    if !only.is_empty() {
        let o = normalize_filter(only);
        return if exact { n == o } else { n.starts_with(&o) };
    }
    if !from.is_empty() && n < normalize_filter(from) {
        return false;
    }
    if !to.is_empty() {
        let t = normalize_filter(to);
        // Inclusive upper bound: "--to=m" must include "Muse", not stop before it.
        if !(n <= t || n.starts_with(&t)) {
            return false;
        }
    }
    true
}

/// Stable key identifying a filter combination, so a resume cannot silently change scope.
pub fn filter_key(from: &str, to: &str, only: &str, exact: bool) -> String {
    format!(
        "from={}|to={}|only={}|exact={}",
        normalize_filter(from),
        normalize_filter(to),
        normalize_filter(only),
        exact
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_filters_accepts_everything() {
        assert!(matches_filter("Radiohead", "", "", "", false));
    }

    #[test]
    fn only_is_a_prefix_unless_exact() {
        assert!(matches_filter("Radiohead", "", "", "radio", false));
        assert!(!matches_filter("Radiohead", "", "", "radio", true));
        assert!(matches_filter("Radiohead", "", "", "RADIOHEAD", true));
    }

    #[test]
    fn only_overrides_range_bounds() {
        assert!(matches_filter("Zappa", "a", "b", "zap", false));
    }

    #[test]
    fn range_bounds_are_inclusive() {
        assert!(matches_filter("Muse", "a", "m", "", false));
        assert!(matches_filter("M", "a", "m", "", false));
        assert!(!matches_filter("Nirvana", "a", "m", "", false));
        assert!(!matches_filter("ABBA", "b", "", "", false));
        assert!(matches_filter("Beatles", "b", "", "", false));
    }

    #[test]
    fn filter_key_distinguishes_scopes() {
        assert_ne!(
            filter_key("", "", "radiohead", false),
            filter_key("", "", "", false)
        );
        assert_ne!(
            filter_key("", "", "x", true),
            filter_key("", "", "x", false)
        );
        assert_eq!(
            filter_key("A", "", "", false),
            filter_key("a", "", "", false)
        );
    }
}
