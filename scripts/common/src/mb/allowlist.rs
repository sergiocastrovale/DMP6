// Which MusicBrainz releases may be bound to a local release. The library is album-oriented and must
// never contain singles. A candidate passes only if its release-group primary type is Album or EP,
// its release status is Official, and its secondary types include none of the non-music kinds below.
// Compilation / Live / Remix / Soundtrack ride on an Album/EP primary type and pass; remasters and
// special editions are not MB types at all (they are Album primary) and pass automatically.

const ALLOWED_PRIMARY_TYPES: &[&str] = &["album", "ep"];

// Secondary types that disqualify an otherwise-album release (spoken-word / non-music kinds).
const REJECTED_SECONDARY_TYPES: &[&str] = &[
    "audiobook",
    "audio drama",
    "spokenword",
    "interview",
    "field recording",
    "demo",
];

/// `status` is the MusicBrainz release status (Official / Bootleg / Promotion / Pseudo-Release / ...).
/// A missing status is treated as Official, matching the existing lenient behaviour in
/// `mb_api::mb_get_release_tracks` (which only skips releases whose status is present and non-Official).
pub fn is_allowed(
    primary_type: Option<&str>,
    secondary_types: &[String],
    status: Option<&str>,
) -> bool {
    let primary_ok = primary_type
        .map(|p| ALLOWED_PRIMARY_TYPES.contains(&p.to_lowercase().as_str()))
        .unwrap_or(false);
    if !primary_ok {
        return false;
    }
    let secondary_ok = !secondary_types
        .iter()
        .any(|s| REJECTED_SECONDARY_TYPES.contains(&s.to_lowercase().as_str()));
    if !secondary_ok {
        return false;
    }
    match status {
        Some(s) => s.eq_ignore_ascii_case("official"),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sec(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn album_ep_official_allowed() {
        assert!(is_allowed(Some("Album"), &[], Some("Official")));
        assert!(is_allowed(Some("EP"), &[], Some("Official")));
    }

    #[test]
    fn null_status_treated_as_official() {
        assert!(is_allowed(Some("Album"), &[], None));
    }

    #[test]
    fn single_broadcast_other_rejected() {
        assert!(!is_allowed(Some("Single"), &[], Some("Official")));
        assert!(!is_allowed(Some("Broadcast"), &[], Some("Official")));
        assert!(!is_allowed(Some("Other"), &[], Some("Official")));
        assert!(!is_allowed(None, &[], Some("Official")));
    }

    #[test]
    fn non_official_status_rejected() {
        assert!(!is_allowed(Some("Album"), &[], Some("Bootleg")));
        assert!(!is_allowed(Some("Album"), &[], Some("Promotion")));
        assert!(!is_allowed(Some("Album"), &[], Some("Pseudo-Release")));
    }

    #[test]
    fn allowed_secondary_types_pass() {
        assert!(is_allowed(
            Some("Album"),
            &sec(&["Compilation"]),
            Some("Official")
        ));
        assert!(is_allowed(Some("Album"), &sec(&["Live"]), Some("Official")));
        assert!(is_allowed(
            Some("Album"),
            &sec(&["Remix"]),
            Some("Official")
        ));
        assert!(is_allowed(
            Some("Album"),
            &sec(&["Soundtrack"]),
            Some("Official")
        ));
    }

    #[test]
    fn rejected_secondary_types_block_even_album() {
        assert!(!is_allowed(
            Some("Album"),
            &sec(&["Audiobook"]),
            Some("Official")
        ));
        assert!(!is_allowed(
            Some("Album"),
            &sec(&["Interview"]),
            Some("Official")
        ));
        assert!(!is_allowed(
            Some("Album"),
            &sec(&["Compilation", "Spokenword"]),
            Some("Official")
        ));
    }

    #[test]
    fn case_insensitive() {
        assert!(is_allowed(
            Some("album"),
            &sec(&["compilation"]),
            Some("official")
        ));
        assert!(!is_allowed(Some("single"), &[], Some("official")));
    }
}
