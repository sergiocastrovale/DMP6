//! Artist-name normalisation and the two matching predicates used against MusicBrainz results.
//!
//! There are deliberately **two** predicates with different strictness, because two different
//! questions get asked:
//!
//! - `names_are_similar` - "is this MB artist plausibly the same entity as the one I already believe
//!   I'm syncing?" Tolerant, survives spelling/punctuation/word-order drift. Used by sync.
//! - `mb_artist_exact` - "is this whole tag string, verbatim, a real artist?" Used by the resolver to
//!   decide whether a compound tag should be split. Must be strict: the fuzzy predicate treats "with"
//!   and "&" as *noise words*, so `"Frank Sinatra with Count Basie"` vs `"Frank Sinatra"` scores
//!   exactly 0.5 and passes - which would confirm nearly every compound string as one artist and split
//!   nothing.

use std::collections::HashSet;

use super::types::MbArtistMatch;

/// Lowercase, drop a leading "the ", strip punctuation, collapse whitespace.
///
/// Trims before the "the " check: previously a leading space made the strip silently no-op, so
/// `" The Beatles"` and `"The Beatles"` normalized differently and compared unequal.
pub fn normalize_name(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    let stripped = lower.strip_prefix("the ").unwrap_or(&lower);
    stripped
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Tolerant similarity: exact normalized match, or >= 50% word overlap ignoring noise words.
/// See the module doc for why this must NOT be used to validate a whole compound tag.
pub fn names_are_similar(a: &str, b: &str) -> bool {
    let na = normalize_name(a);
    let nb = normalize_name(b);
    if na == nb {
        return true;
    }

    let noise: HashSet<&str> = [
        "the", "and", "&", "a", "an", "of", "in", "on", "at", "to", "for", "with", "by", "from",
        "or", "is", "et", "und", "e", "y", "i",
    ]
    .iter()
    .copied()
    .collect();

    let words_a: HashSet<&str> = na
        .split_whitespace()
        .filter(|w| !noise.contains(*w))
        .collect();
    let words_b: HashSet<&str> = nb
        .split_whitespace()
        .filter(|w| !noise.contains(*w))
        .collect();

    if words_a.is_empty() || words_b.is_empty() {
        return false;
    }

    let intersection = words_a.intersection(&words_b).count();
    let union = words_a.union(&words_b).count();
    intersection as f64 / union as f64 >= 0.5
}

/// Strict identity: the queried string normalizes exactly to the MB artist's name, or to one of its
/// aliases. No partial-overlap credit.
pub fn mb_artist_exact(query: &str, candidate: &MbArtistMatch) -> bool {
    let nq = normalize_name(query);
    if nq.is_empty() {
        return false;
    }
    if normalize_name(&candidate.name) == nq {
        return true;
    }
    candidate
        .aliases
        .as_deref()
        .unwrap_or_default()
        .iter()
        .any(|alias| normalize_name(&alias.name) == nq)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mb::types::MbAlias;

    fn artist(name: &str, aliases: &[&str]) -> MbArtistMatch {
        MbArtistMatch {
            id: "test-id".to_string(),
            name: name.to_string(),
            score: Some(100),
            aliases: Some(
                aliases
                    .iter()
                    .map(|a| MbAlias {
                        name: a.to_string(),
                    })
                    .collect(),
            ),
        }
    }

    #[test]
    fn exact_accepts_a_real_band_whose_name_contains_a_separator_word() {
        // The whole point: these are single artists, not "X with Y" collaborations.
        assert!(mb_artist_exact(
            "Nurse With Wound",
            &artist("Nurse With Wound", &[])
        ));
        assert!(mb_artist_exact(
            "MAN WITH A MISSION",
            &artist("MAN WITH A MISSION", &[])
        ));
        assert!(mb_artist_exact(
            "Dance With the Dead",
            &artist("Dance With the Dead", &[])
        ));
        assert!(mb_artist_exact(
            "Mumford & Sons",
            &artist("Mumford & Sons", &[])
        ));
    }

    #[test]
    fn exact_rejects_a_compound_string_matching_only_its_first_artist() {
        // The regression that makes the whole refactor necessary. names_are_similar returns TRUE here
        // (0.5 Jaccard, "with" is a noise word), which would leave the compound unsplit.
        let sinatra = artist("Frank Sinatra", &[]);
        assert!(!mb_artist_exact("Frank Sinatra with Count Basie", &sinatra));
        assert!(names_are_similar(
            "Frank Sinatra with Count Basie",
            "Frank Sinatra"
        ));
    }

    #[test]
    fn exact_matches_via_alias() {
        let candidate = artist("Nurse With Wound", &["N.W.W.", "nurse with wound"]);
        assert!(mb_artist_exact("N.W.W.", &candidate));
    }

    #[test]
    fn exact_ignores_case_punctuation_and_leading_the() {
        assert!(mb_artist_exact("the beatles", &artist("The Beatles", &[])));
        assert!(mb_artist_exact("B.B. King", &artist("BB King", &[])));
    }

    #[test]
    fn exact_rejects_empty_and_unrelated() {
        assert!(!mb_artist_exact("", &artist("Anything", &[])));
        assert!(!mb_artist_exact(
            "Count Basie",
            &artist("Frank Sinatra", &[])
        ));
    }

    #[test]
    fn normalize_is_stable() {
        assert_eq!(
            normalize_name("  The   Rolling  Stones! "),
            "rolling stones"
        );
    }
}
