//! Shared candidate-value filtering and folder-wide majority voting, used by every fix kind that
//! derives a replacement artist-shaped value (`artist` or `albumArtist`) from tags already on disk -
//! never MusicBrainz, see each fix module's own doc for why.

use std::collections::HashMap;
use std::path::Path;

use crate::audio::{is_audio_file, read_tags_guarded, TagSnapshot};
use crate::checks::artist::{
    index_treats_as_special, is_unknown_artist, numeric_or_corrupted, unrecognised_various,
};
use crate::checks::text::{is_punctuation_only, is_whitespace_only};

/// Rejects empty/whitespace/punctuation-only values and every "not a real artist" shape the
/// scanner itself already knows about (Various Artists markers, Unknown Artist, numeric/track-number
/// junk) - reused rather than re-invented so a candidate a fixer would accept is held to exactly the
/// same bar the detector uses to flag everything else.
pub fn is_usable_candidate(name: &str) -> bool {
    let t = name.trim();
    if t.is_empty() || is_whitespace_only(name) || is_punctuation_only(name) {
        return false;
    }
    if index_treats_as_special(t) || is_unknown_artist(t) {
        return false;
    }
    if numeric_or_corrupted(t).is_some() {
        return false;
    }
    if unrecognised_various(t).is_some() {
        return false;
    }
    true
}

/// Strict majority of `field(snapshot)` among every audio file in the folder (recursing into disc
/// subfolders), among files where the field is present and not junk. No majority ⇒ `None`, not a
/// guess.
pub fn folder_majority(folder: &Path, field: impl Fn(&TagSnapshot) -> Option<&str>) -> Option<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for entry in walkdir::WalkDir::new(folder)
        .follow_links(true)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_dir() {
            continue;
        }
        let path = entry.path();
        if !is_audio_file(path) {
            continue;
        }
        if let Ok(snap) = read_tags_guarded(path) {
            if let Some(v) = field(&snap) {
                if is_usable_candidate(v) {
                    *counts.entry(v.trim().to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    let total: usize = counts.values().sum();
    if total == 0 {
        return None;
    }
    counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .filter(|(_, c)| c * 2 > total)
        .map(|(v, _)| v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usable_candidate_rejects_junk() {
        assert!(!is_usable_candidate(""));
        assert!(!is_usable_candidate("   "));
        assert!(!is_usable_candidate("Various Artists"));
        assert!(!is_usable_candidate("Unknown Artist"));
        assert!(!is_usable_candidate("07"));
        assert!(!is_usable_candidate("V.A."));
        assert!(!is_usable_candidate("!!!!"));
    }

    #[test]
    fn usable_candidate_accepts_real_names() {
        assert!(is_usable_candidate("Hank Mobley"));
        assert!(is_usable_candidate("  Radiohead  "));
        assert!(is_usable_candidate("blink-182"));
        assert!(is_usable_candidate("The 1975"));
        // A real band whose name is a bare number stays accepted (mirrors numeric_or_corrupted).
        assert!(is_usable_candidate("311"));
        assert!(is_usable_candidate("3"));
        assert!(is_usable_candidate("22-20s"));
    }
}
