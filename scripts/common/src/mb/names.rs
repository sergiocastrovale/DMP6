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

use unicode_normalization::UnicodeNormalization;

use super::types::MbArtistMatch;

/// Lowercase, fold accents away, drop a leading "the ", strip punctuation, collapse whitespace.
///
/// Trims before the "the " check: without it, a leading space makes the strip silently no-op, so
/// `" The Beatles"` and `"The Beatles"` normalize differently and compare unequal.
///
/// Accent folding (NFD decompose, drop combining marks) matters more here than in
/// `names_are_similar`'s word-overlap scoring, which tolerates an accent mismatch by accident (the
/// words still share enough characters to pass); `mb_artist_exact` compares whole strings for
/// equality, and `certain_match` (below) decides whether an identity may be *claimed* - a real,
/// accented artist must not silently fail that on spelling alone.
pub fn normalize_name(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    let stripped = lower.strip_prefix("the ").unwrap_or(&lower);
    let folded: String = stripped
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect();
    folded
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Tolerant similarity: exact normalized match, or >= 50% word overlap ignoring noise words.
/// See the module doc for why this must NOT validate a whole compound tag.
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

/// What an independent, name-keyed source (`MbArtistLookup`) says about a proposed identity for
/// `name` - the oracle `certain_match` consults to tell a real match from a merely plausible one.
///
/// Three states, not two, because "the strict search found nothing for this exact string" is evidence
/// about *that string*, not counter-evidence against every candidate a looser search might still find -
/// see `common::mb::cache`'s own module note on why a cached miss must never short-circuit a fuzzy
/// search. Collapsing `DefiniteMiss` into "no opinion" here would make this gate agree with that
/// caller-side rule for free; keeping it distinct instead lets `certain_match` treat "cache disagrees"
/// and "cache has nothing to say" differently, which is exactly the distinction the Wardell Gray Quintet
/// case turns on (docs/sync_decisions.md §4: the cache held the *right* answer and was never asked).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CacheAnswer {
    /// The independent lookup for this exact name resolved to this id.
    Hit(String),
    /// The independent lookup for this exact name found nothing. Not a contradiction - see above.
    DefiniteMiss,
    /// This exact name has never been looked up. No evidence either way.
    Absent,
}

/// Is `candidate` **certainly** the artist named `name` - certain enough to *claim* an identity
/// (write it to a row), not merely to justify searching for that artist's releases.
///
/// docs/sync_decisions.md §5 states the rule this function exists to enforce: only an exact,
/// independently-verified match may claim an identity. A tolerant/fuzzy match (`names_are_similar`)
/// may still find and sync an already-believed-in artist's releases; it must never reach here.
///
/// Two ways to be certain:
///   1. an independent, name-keyed lookup already resolved this exact name to this exact id
///      (`CacheAnswer::Hit` agreeing with `candidate.id`) - the strongest possible evidence, since it
///      comes from a source that never writes on a fuzzy match;
///   2. failing that, the candidate's own name or alias set matches the queried name exactly
///      (`mb_artist_exact`) - certain on its own terms even with no cache entry.
///
/// A `CacheAnswer::Hit` for a *different* id is the one case worth naming on its own: the id being
/// proposed is contradicted by independent evidence, not merely unproven. `certain_match` still
/// returns `false` for it (right decision), but a caller deciding whether to *clear* an existing wrong
/// value - as opposed to merely declining to set a new one - needs to tell "contradicted" apart from
/// "unproven". Use `identity_verdict` for that; `certain_match` is `identity_verdict(..).is_certain()`.
pub fn certain_match(name: &str, candidate: &MbArtistMatch, cached: &CacheAnswer) -> bool {
    identity_verdict(name, candidate, cached).is_certain()
}

/// The full three-way answer behind `certain_match` - see its doc for the reasoning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityVerdict {
    /// Certain: safe to claim.
    Certain,
    /// An independent lookup for this exact name confirms a *different* id. Never claim; a caller
    /// clearing an existing value should treat this as grounds to clear it.
    Contradicted { independent_mbid: String },
    /// No corroboration and no exact name/alias match. Never claim; not grounds to clear an existing
    /// value either - "unproven" is not "disproven" (docs/sync_decisions.md §4/§5).
    Unproven,
}

impl IdentityVerdict {
    pub fn is_certain(&self) -> bool {
        matches!(self, IdentityVerdict::Certain)
    }
}

pub fn identity_verdict(
    name: &str,
    candidate: &MbArtistMatch,
    cached: &CacheAnswer,
) -> IdentityVerdict {
    match cached {
        CacheAnswer::Hit(id) if *id == candidate.id => IdentityVerdict::Certain,
        CacheAnswer::Hit(id) => IdentityVerdict::Contradicted {
            independent_mbid: id.clone(),
        },
        CacheAnswer::DefiniteMiss | CacheAnswer::Absent => {
            if mb_artist_exact(name, candidate) {
                IdentityVerdict::Certain
            } else {
                IdentityVerdict::Unproven
            }
        }
    }
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

    #[test]
    fn normalize_folds_diacritics_so_accented_and_plain_spellings_agree() {
        // names_are_similar's word-overlap scoring tolerated this by accident; certain_match compares
        // whole strings for equality and would otherwise treat every accented artist as unproven.
        assert_eq!(normalize_name("Gábor Szabó"), normalize_name("Gabor Szabo"));
    }

    // --- certain_match / identity_verdict --------------------------------------------------------
    //
    // No artist names, real or invented, in any fixture below - only opaque placeholder strings and
    // ids. This function operates on (queried string, candidate, cache answer) with no idea what a
    // "name" looks like semantically, so a test of it needs no name-shaped input. See
    // docs/sync_decisions.md §4/§5 for the real, traced incident this logic exists to prevent.

    fn placeholder_id(n: u8) -> String {
        format!("00000000-0000-0000-0000-{n:012}")
    }

    fn candidate_with_id(id: &str) -> MbArtistMatch {
        MbArtistMatch {
            id: id.to_string(),
            name: "queried-name".to_string(),
            score: Some(100),
            aliases: None,
        }
    }

    #[test]
    fn a_candidate_id_the_cache_disagrees_with_is_contradicted_not_certain() {
        let cached = CacheAnswer::Hit(placeholder_id(1));

        let disagreeing = candidate_with_id(&placeholder_id(2));
        assert!(!certain_match("queried-name", &disagreeing, &cached));
        assert_eq!(
            identity_verdict("queried-name", &disagreeing, &cached),
            IdentityVerdict::Contradicted {
                independent_mbid: placeholder_id(1)
            }
        );

        // Same query, the id the cache itself names: certain.
        let agreeing = candidate_with_id(&placeholder_id(1));
        assert!(certain_match("queried-name", &agreeing, &cached));
    }

    #[test]
    fn word_overlap_similarity_is_not_certainty() {
        // Pin the OLD predicate's behaviour in the same test as the new one: a revert of the gate
        // cannot silently pass this test, because the first assertion would then contradict the
        // second having been the reason the bug existed at all.
        assert!(
            names_are_similar("alpha beta", "alpha beta gamma"),
            "this is *why* the old code accepted it - 2/3 word overlap clears the 0.5 bar"
        );
        let candidate = artist("alpha beta gamma", &[]);
        assert!(
            !certain_match("alpha beta", &candidate, &CacheAnswer::Absent),
            "no wild guesses: similarity is not certainty"
        );
        // With the cache's own, distinct answer for the queried string, the similar-but-different
        // candidate is contradicted outright rather than merely unproven.
        let cached = CacheAnswer::Hit(placeholder_id(3));
        assert!(!certain_match("alpha beta", &candidate, &cached));
    }

    #[test]
    fn no_cache_entry_falls_back_to_exact_name_or_alias_match() {
        let cached = CacheAnswer::Absent;
        assert!(certain_match(
            "queried-name",
            &artist("queried-name", &[]),
            &cached
        ));
        assert!(certain_match(
            "short-form",
            &artist("queried-name", &["short-form"]),
            &cached
        ));
        assert!(!certain_match(
            "alpha beta",
            &artist("alpha beta gamma", &[]),
            &cached
        ));
    }

    #[test]
    fn a_definite_cache_miss_is_not_a_contradiction() {
        // The strict search finding nothing for this exact string says nothing about whether THIS
        // candidate, found some other way, is right - it only says the string itself has no exact
        // independent answer. Must behave exactly like Absent here, never like a contradiction.
        let cached = CacheAnswer::DefiniteMiss;
        assert_eq!(
            identity_verdict("queried-name", &artist("queried-name", &[]), &cached),
            IdentityVerdict::Certain
        );
        assert_eq!(
            identity_verdict("queried-name", &artist("unrelated-name", &[]), &cached),
            IdentityVerdict::Unproven
        );
    }
}
