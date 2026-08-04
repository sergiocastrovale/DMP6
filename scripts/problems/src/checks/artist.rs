//! Checks specific to the `artist` and `albumArtist` tags.
//!
//! The Various-Artists predicates mirror `scripts/common/src/artists.rs:31-45`
//! (`is_various_artists`, `is_special_artist_name`). They are copied rather than imported so this
//! crate stays free of the `common` dependency graph; the tests below pin the exact accepted set,
//! so a drift in the real guard shows up as a documented difference rather than a silent one.

use super::separators::{
    co_billing_parts, separator_positions, MAX_CO_OWNERS, MAX_SPAN_SEPARATORS,
};

/// Mirror of `common::artists::is_various_artists`.
///
/// Note it does **not** trim - that is not an oversight in the copy, it is the real behaviour, and
/// it is exactly why [`is_untrimmed`](super::text::is_untrimmed) on an albumArtist is worth
/// reporting: `" Various Artists"` slips past this and becomes a browsable artist.
pub fn index_treats_as_various(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "various artists"
        || lower == "various"
        || lower == "va"
        || lower.starts_with("various artists,")
        || lower.starts_with("various artists &")
        || lower.starts_with("various artists /")
}

/// Mirror of `common::artists::is_special_artist_name`.
pub fn index_treats_as_special(name: &str) -> bool {
    let lower = name.to_lowercase();
    index_treats_as_various(name) || lower == "unknown" || lower == "[unknown]"
}

/// Compilation markers the indexer does **not** recognise, each of which therefore becomes a real
/// browsable artist row and gets searched against MusicBrainz.
const UNRECOGNISED_VARIOUS: &[&str] = &[
    "v/a",
    "v.a.",
    "v.a",
    "va.",
    "various artist",
    "various artistes",
    "varios artistas",
    "vários artistas",
    "verschiedene",
    "verschiedene interpreten",
    "diverse",
    "diversen",
    "compilation",
    "compilations",
    "soundtrack",
    "original soundtrack",
    "ost",
    "sampler",
    "unknown artist",
    "unknown artists",
];

/// Returns the matched marker when this value is a compilation placeholder the indexer will treat
/// as a genuine artist name.
///
/// `"Unknown Artist"` is deliberately handled by its own [`is_unknown_artist`] check so it can carry
/// a more specific message, and is excluded here to avoid double-reporting.
pub fn unrecognised_various(name: &str) -> Option<&'static str> {
    let lower = name.trim().to_lowercase();
    if index_treats_as_various(name.trim()) || is_unknown_artist(name) {
        return None;
    }
    UNRECOGNISED_VARIOUS.iter().copied().find(|m| *m == lower)
}

/// The literal `Unknown Artist` placeholder. Not special-cased by the indexer or by sync, so it
/// becomes one shared junk artist page that real releases get attached to.
pub fn is_unknown_artist(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    lower == "unknown artist" || lower == "unknown artists"
}

/// Why a value would break the MusicBrainz artist query, if it would.
///
/// `common::mb::api` builds the query as `format!("\"{}\"", name)` with **no escaping** (contrast
/// its own release-group search, which does strip quotes). Two shapes break the resulting Lucene
/// syntax and make MusicBrainz answer HTTP 400. The resolver classifies a non-404 error as
/// transient and defers - and deferred lookups are never cached, so the name is re-fetched, re-fails
/// and re-defers on every single run, forever, and the release's ownership is never reconciled.
pub fn breaks_lucene_query(name: &str) -> Option<&'static str> {
    if name.contains('"') {
        return Some("contains a double quote");
    }
    // Only an ODD number of trailing backslashes is dangerous: the closing quote gets escaped.
    // An even count self-escapes and is harmless, so flagging it would be a false positive.
    let trailing = name.chars().rev().take_while(|c| *c == '\\').count();
    if trailing % 2 == 1 {
        return Some("ends with an unescaped backslash");
    }
    None
}

/// Why a value looks like machine junk rather than an artist name, if it does.
///
/// Extends the SQL rules in `scripts/audit/src/corrupted.rs:16-27`, which can only see values
/// already in the database. The bare 4-digit-year rule is the notable addition: the audit only
/// catches a year in albumArtist when it happens to equal that track's own year column, so a
/// mistagged `"1997"` on a track with a null or different year is invisible to it.
pub fn numeric_or_corrupted(name: &str) -> Option<String> {
    let t = name.trim();
    if t.is_empty() {
        return None;
    }

    // A bare 1-3 digit number is a track number that leaked into the tag. Deliberately does not
    // cover 3-digit values that are real band names - see the exception list below.
    if t.len() <= 3 && t.chars().all(|c| c.is_ascii_digit()) && !is_numeric_band_name(t) {
        return Some("looks like a track number".into());
    }

    // "07 - Song Title"
    let mut it = t.chars();
    let lead_digits: String = it.by_ref().take_while(|c| c.is_ascii_digit()).collect();
    if (1..=3).contains(&lead_digits.len()) {
        let rest = &t[lead_digits.len()..];
        let rest_trim = rest.trim_start();
        if rest_trim.starts_with('-') && rest_trim[1..].trim_start().chars().next().is_some() {
            return Some("looks like a numbered track title".into());
        }
    }

    // "Artist@320" - a bitrate suffix from a ripping tool.
    if let Some(pos) = t.rfind('@') {
        let suffix = &t[pos + 1..];
        if (2..=3).contains(&suffix.len()) && suffix.chars().all(|c| c.is_ascii_digit()) {
            return Some("has a bitrate suffix".into());
        }
    }

    // A literal fragment of a tag path, from a broken tagging script.
    if t.to_lowercase().contains("lbumartist/") {
        return Some("contains a literal tag-path fragment".into());
    }

    // A bare 4-digit year in the artist field.
    if t.len() == 4 && t.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(n) = t.parse::<i32>() {
            if (1000..=2999).contains(&n) {
                return Some("is a bare year".into());
            }
        }
    }

    None
}

/// Real bands whose entire name is a short number. Without this, the track-number rule would
/// report them on every one of their files.
fn is_numeric_band_name(s: &str) -> bool {
    matches!(s, "311" | "112" | "702" | "98" | "504")
}

/// Reports a tag whose separator count exceeds what the resolver will verify.
pub fn too_many_separators(name: &str) -> Option<usize> {
    let n = separator_positions(name).len();
    (n > MAX_SPAN_SEPARATORS).then_some(n)
}

/// Reports a tag listing more co-billed artists than the resolver keeps as owners.
pub fn too_many_co_owners(name: &str) -> Option<usize> {
    let n = co_billing_parts(name);
    (n > MAX_CO_OWNERS).then_some(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn various_mirror_matches_the_indexers_exact_set() {
        for good in [
            "Various Artists",
            "various artists",
            "VARIOUS",
            "va",
            "Various Artists, Vol 1",
            "Various Artists & Friends",
            "Various Artists / Sampler",
        ] {
            assert!(
                index_treats_as_various(good),
                "should be recognised: {good}"
            );
        }
        for bad in [
            "V/A",
            "V.A.",
            "Various Artist",
            "Varios Artistas",
            "Compilation",
            "OST",
        ] {
            assert!(
                !index_treats_as_various(bad),
                "should NOT be recognised: {bad}"
            );
        }
        // Untrimmed is the whole point of the AlbumArtistUntrimmed check.
        assert!(!index_treats_as_various(" Various Artists"));
    }

    #[test]
    fn unrecognised_various_flags_the_gaps_only() {
        assert!(unrecognised_various("V/A").is_some());
        assert!(unrecognised_various("V.A.").is_some());
        assert!(unrecognised_various("Various Artist").is_some());
        assert!(unrecognised_various("Soundtrack").is_some());
        assert!(unrecognised_various("OST").is_some());
        assert!(unrecognised_various("Verschiedene").is_some());
        // Already handled by the indexer - reporting it would be noise.
        assert!(unrecognised_various("Various Artists").is_none());
        // Handled by its own more specific check.
        assert!(unrecognised_various("Unknown Artist").is_none());
        // A real band whose name merely starts with "Various".
        assert!(unrecognised_various("Various Production").is_none());
        assert!(unrecognised_various("Radiohead").is_none());
    }

    #[test]
    fn unknown_artist_is_detected() {
        assert!(is_unknown_artist("Unknown Artist"));
        assert!(is_unknown_artist("  unknown artists  "));
        assert!(!is_unknown_artist("Unknown Mortal Orchestra"));
        assert!(!is_unknown_artist("Unknown"));
    }

    #[test]
    fn lucene_breakage_distinguishes_odd_from_even_backslashes() {
        assert!(breaks_lucene_query("Guns N\" Roses").is_some());
        assert!(
            breaks_lucene_query("AC\\").is_some(),
            "odd trailing backslash escapes the quote"
        );
        assert!(
            breaks_lucene_query("AC\\\\").is_none(),
            "even count self-escapes - not a defect"
        );
        assert!(breaks_lucene_query("AC\\\\\\").is_some());
    }

    #[test]
    fn lucene_check_leaves_awkward_but_safe_names_alone() {
        // These all look alarming and are all completely fine in a quoted Lucene phrase.
        for name in [
            "AC/DC",
            "Sunn O)))",
            "!!!",
            "†††",
            "Godspeed You! Black Emperor",
            "P!nk",
        ] {
            assert!(
                breaks_lucene_query(name).is_none(),
                "false positive: {name}"
            );
        }
    }

    #[test]
    fn numeric_junk_catches_the_real_corruption_patterns() {
        assert!(numeric_or_corrupted("03").is_some());
        assert!(numeric_or_corrupted("7").is_some());
        assert!(numeric_or_corrupted("12 - Intro").is_some());
        assert!(numeric_or_corrupted("07-Song").is_some());
        assert!(numeric_or_corrupted("Artist@320").is_some());
        assert!(numeric_or_corrupted("lbumArtist/Foo").is_some());
        assert!(numeric_or_corrupted("1997").is_some());
    }

    #[test]
    fn numeric_junk_spares_bands_that_look_numeric() {
        // Each of these is a real artist. Flagging any of them puts a false row on every file
        // they own, which is how a report loses credibility.
        for name in [
            "The 1975",
            "blink-182",
            "2Pac",
            "98 Degrees",
            "311",
            "112",
            "3 Doors Down",
        ] {
            assert!(
                numeric_or_corrupted(name).is_none(),
                "false positive: {name}"
            );
        }
    }

    #[test]
    fn separator_and_co_owner_limits_flag_only_past_the_boundary() {
        assert!(too_many_co_owners("Crosby, Stills, Nash & Young").is_none());
        assert_eq!(too_many_co_owners("A, B, C, D, E"), Some(5));
        assert!(too_many_separators("Simon & Garfunkel").is_none());
        assert!(too_many_separators("A, B, C, D, E, F, G, H, I, J").is_some());
    }
}
