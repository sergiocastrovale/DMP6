// Which MusicBrainz releases may be bound to a local release. The library is album-oriented: a
// candidate passes only if its release-group primary type is Album or EP, its release status is
// Official, and its secondary types include none of the non-music kinds below. Compilation / Live /
// Remix / Soundtrack ride on an Album/EP primary type and pass; remasters and special editions are
// not MB types at all (they are Album primary) and pass automatically. The one exception is
// `is_allowed_tagged` - see TAGGED_ONLY_PRIMARY_TYPES.

const ALLOWED_PRIMARY_TYPES: &[&str] = &["album", "ep"];

// Singles are never browsed, searched or invented as catalogue gaps - but a file whose own tags carry
// the MusicBrainz release (or release-group) id of a Single is a disc the user physically owns, and
// MusicBrainz files plenty of 4-track CD "EP"s under a Single group (Radiohead's 1993 "Creep" is the
// canonical case: an exact 4/4 match that sat Unmatched for years). Those bind, and they enter the
// catalogue typed "Single" so the artist page's Singles filter can find them.
const TAGGED_ONLY_PRIMARY_TYPES: &[&str] = &["single"];

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
    check(primary_type, secondary_types, status, &[])
}

/// The gate for a candidate the local files themselves point at (a unanimous embedded
/// `MUSICBRAINZ_ALBUMID` or `MUSICBRAINZ_RELEASEGROUPID`). Identical to [`is_allowed`] except that a
/// Single-typed group passes: the tags are definitive about a disc that is already on disk. Search
/// hits and catalogue gaps must keep using [`is_allowed`], or the library starts inventing singles.
pub fn is_allowed_tagged(
    primary_type: Option<&str>,
    secondary_types: &[String],
    status: Option<&str>,
) -> bool {
    check(
        primary_type,
        secondary_types,
        status,
        TAGGED_ONLY_PRIMARY_TYPES,
    )
}

fn check(
    primary_type: Option<&str>,
    secondary_types: &[String],
    status: Option<&str>,
    extra_primary_types: &[&str],
) -> bool {
    let primary_ok = primary_type
        .map(|p| {
            let p = p.to_lowercase();
            ALLOWED_PRIMARY_TYPES.contains(&p.as_str()) || extra_primary_types.contains(&p.as_str())
        })
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

/// Whether a release group with no local copy may be recorded as a MISSING catalogue entry.
///
/// A gap has no specific release, so `is_allowed` sees `status = None` and treats the group as
/// Official - which is how bootleg live recordings got in: they are primary Album with a Live
/// secondary type, indistinguishable from an official live album by type alone. `official_rg_ids`
/// (from `api::mb_get_official_release_group_ids`) supplies the status the group itself lacks.
pub fn is_allowed_gap(
    primary_type: Option<&str>,
    secondary_types: &[String],
    rg_id: &str,
    official_rg_ids: &std::collections::HashSet<String>,
) -> bool {
    official_rg_ids.contains(rg_id) && is_allowed(primary_type, secondary_types, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn sec(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn official(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tagged_singles_bind_but_only_when_official_and_tagged() {
        // MusicBrainz files plenty of owned 4-track CD "EP"s under a Single group.
        assert!(is_allowed_tagged(Some("Single"), &[], Some("Official")));
        assert!(!is_allowed(Some("Single"), &[], Some("Official")));
        // The Single exception never relaxes the other two rules.
        assert!(!is_allowed_tagged(Some("Single"), &[], Some("Bootleg")));
        assert!(!is_allowed_tagged(
            Some("Single"),
            &sec(&["Interview"]),
            Some("Official")
        ));
        // Nor does it open the other banned primary types.
        assert!(!is_allowed_tagged(Some("Broadcast"), &[], Some("Official")));
        assert!(!is_allowed_tagged(Some("Other"), &[], Some("Official")));
    }

    #[test]
    fn tagged_gate_still_accepts_everything_the_normal_gate_does() {
        assert!(is_allowed_tagged(Some("Album"), &[], Some("Official")));
        assert!(is_allowed_tagged(Some("EP"), &sec(&["Live"]), None));
    }

    #[test]
    fn gap_needs_an_official_release_in_the_group() {
        let ids = official(&["rg-official"]);
        assert!(is_allowed_gap(Some("Album"), &sec(&["Live"]), "rg-official", &ids));
        // Same shape, but every release in the group is a bootleg - the Radiohead soundboard case.
        assert!(!is_allowed_gap(Some("Album"), &sec(&["Live"]), "rg-bootleg", &ids));
    }

    #[test]
    fn gap_still_obeys_the_type_allow_list() {
        let ids = official(&["rg-single", "rg-audiobook"]);
        assert!(!is_allowed_gap(Some("Single"), &[], "rg-single", &ids));
        assert!(!is_allowed_gap(
            Some("Album"),
            &sec(&["Audiobook"]),
            "rg-audiobook",
            &ids
        ));
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
