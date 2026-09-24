//! Pure helpers for turning an artist name into a filesystem-safe folder name under MUSIC_DIR.
//! Kept separate from `main.rs` so they're directly unit-testable without a DB/network context.

/// Sanitizes a name into a single path component: replaces path separators and NUL with `-`, trims
/// whitespace, and strips trailing dots (Windows/some filesystems reject a trailing dot; harmless to
/// strip everywhere else). Returns `None` for a name that sanitizes to nothing.
pub fn folder_name(name: &str) -> Option<String> {
    let replaced: String = name
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == '\0' {
                '-'
            } else {
                c
            }
        })
        .collect();
    let trimmed = replaced.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_name_unchanged() {
        assert_eq!(folder_name("Radiohead"), Some("Radiohead".to_string()));
    }

    #[test]
    fn replaces_path_separators() {
        assert_eq!(folder_name("AC/DC"), Some("AC-DC".to_string()));
        assert_eq!(folder_name("A\\B"), Some("A-B".to_string()));
    }

    #[test]
    fn strips_trailing_dots_and_whitespace() {
        assert_eq!(folder_name("  Sigur Rós.  "), Some("Sigur Rós".to_string()));
    }

    #[test]
    fn empty_after_sanitize_is_none() {
        assert_eq!(folder_name(""), None);
        assert_eq!(folder_name("   "), None);
        assert_eq!(folder_name("..."), None);
    }

    #[test]
    fn nul_byte_replaced() {
        assert_eq!(folder_name("A\0B"), Some("A-B".to_string()));
    }
}
