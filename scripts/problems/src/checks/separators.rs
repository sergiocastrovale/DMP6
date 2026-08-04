//! Mirror of the resolver's separator scanning.
//!
//! Source: `scripts/common/src/mb/resolve.rs:129-198` (`SEPARATOR_PATTERNS`, `Separator`,
//! `separator_positions`) plus the `MAX_SPAN_SEPARATORS` / `MAX_CO_OWNERS` constants at lines 29/35.
//!
//! Copied **verbatim, including quirks**, rather than simplified. This module's only job is to
//! predict what the real resolver will do with a tag; a "cleaner" reimplementation that behaves
//! differently would make the report describe a pipeline that does not exist.
//!
//! Kept in sync by hand. If the resolver's separator table changes, the tests below still pass
//! (they test this copy, not the original) - but the report starts lying, so update both together.

/// How a tag's parts relate, which decides ownership of a release.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinKind {
    /// "A & B", "A, B", "A and B" - everyone co-owns the release.
    CoBilling,
    /// "A with B", "A feat. B" - A owns the release, B is only credited on the track.
    Guest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Separator {
    pub start: usize,
    pub end: usize,
    pub kind: JoinKind,
}

/// Longest-first so " featuring " wins over " ft. " and " and " is not found inside a longer phrase.
const SEPARATOR_PATTERNS: &[(&str, JoinKind)] = &[
    (" featuring ", JoinKind::Guest),
    (" feat. ", JoinKind::Guest),
    (" feat ", JoinKind::Guest),
    (" ft. ", JoinKind::Guest),
    (" ft ", JoinKind::Guest),
    (" with ", JoinKind::Guest),
    (" vs. ", JoinKind::CoBilling),
    (" vs ", JoinKind::CoBilling),
    (" and ", JoinKind::CoBilling),
    (" & ", JoinKind::CoBilling),
    (" x ", JoinKind::CoBilling),
    ("; ", JoinKind::CoBilling),
    (", ", JoinKind::CoBilling),
    (" / ", JoinKind::CoBilling),
    (" \\ ", JoinKind::CoBilling),
    ("\\", JoinKind::CoBilling),
    ("|", JoinKind::CoBilling),
];

/// Beyond this many separators the resolver gives up on verifying groupings and falls straight
/// through to treating each atom as an artist - unverified, which is how junk owners appear.
pub const MAX_SPAN_SEPARATORS: usize = 8;

/// Above this many co-billed parts the resolver treats the tag as a personnel list and demotes
/// everyone past the first to a mere credit.
pub const MAX_CO_OWNERS: usize = 4;

/// Find every candidate split point. Purely syntactic - proposes, never decides.
pub fn separator_positions(name: &str) -> Vec<Separator> {
    let bytes = name.as_bytes();
    let lower = name.to_lowercase();
    let mut found: Vec<Separator> = Vec::new();
    let mut i = 0usize;

    'outer: while i < name.len() {
        if !name.is_char_boundary(i) || i >= lower.len() || !lower.is_char_boundary(i) {
            i += 1;
            continue;
        }
        for (pat, kind) in SEPARATOR_PATTERNS {
            if lower[i..].starts_with(pat) {
                // "10,000 Maniacs" - a comma wrapped in digits is part of the number.
                if *pat == ", " {
                    let prev_digit = i > 0 && bytes[i - 1].is_ascii_digit();
                    let next = i + pat.len();
                    let next_digit = next < bytes.len() && bytes[next].is_ascii_digit();
                    if prev_digit && next_digit {
                        i += 1;
                        continue 'outer;
                    }
                }
                found.push(Separator {
                    start: i,
                    end: i + pat.len(),
                    kind: *kind,
                });
                i += pat.len();
                continue 'outer;
            }
        }
        i += 1;
    }

    found
}

/// How many parts the resolver would treat as co-owners.
///
/// The parts before the first `Guest` separator are the co-billed run; everything after it is a
/// credit regardless of how it is joined. So "A & B feat. C" has two co-owners, not three.
pub fn co_billing_parts(name: &str) -> usize {
    if name.trim().is_empty() {
        return 0;
    }
    let seps = separator_positions(name);
    let mut parts = 1usize;
    for sep in seps {
        match sep.kind {
            JoinKind::Guest => break,
            JoinKind::CoBilling => parts += 1,
        }
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_comma_is_not_a_separator() {
        assert_eq!(co_billing_parts("10,000 Maniacs"), 1);
        assert!(separator_positions("10,000 Maniacs").is_empty());
    }

    #[test]
    fn co_billing_counts_stop_at_the_first_guest_join() {
        assert_eq!(co_billing_parts("A & B"), 2);
        assert_eq!(
            co_billing_parts("A & B feat. C"),
            2,
            "a guest ends the co-billed run"
        );
        assert_eq!(co_billing_parts("A feat. B, C"), 1);
    }

    #[test]
    fn max_co_owners_boundary_does_not_shred_real_bands() {
        // Exactly at the limit: must NOT be flagged. Getting this boundary wrong would report
        // every four-piece supergroup in the library as broken.
        assert_eq!(co_billing_parts("Crosby, Stills, Nash & Young"), 4);
        assert!(co_billing_parts("Crosby, Stills, Nash & Young") <= MAX_CO_OWNERS);
        assert_eq!(co_billing_parts("Earth, Wind & Fire"), 3);
        // One past the limit: flagged.
        assert_eq!(co_billing_parts("A, B, C, D, E"), 5);
        assert!(co_billing_parts("A, B, C, D, E") > MAX_CO_OWNERS);
    }

    #[test]
    fn x_and_and_are_separators() {
        assert_eq!(co_billing_parts("Travis Scott x The Weeknd"), 2);
        assert_eq!(co_billing_parts("Frank Sinatra and Count Basie"), 2);
    }

    #[test]
    fn pathological_tags_exceed_the_span_limit() {
        let dump = "A, B, C, D, E, F, G, H, I, J";
        assert!(separator_positions(dump).len() > MAX_SPAN_SEPARATORS);
        assert!(separator_positions("Simon & Garfunkel").len() <= MAX_SPAN_SEPARATORS);
    }

    #[test]
    fn names_without_separators_are_single_parts() {
        for name in ["Radiohead", "AC/DC", "Florence + The Machine", "R+R=NOW"] {
            assert_eq!(co_billing_parts(name), 1, "unexpectedly split: {name}");
        }
    }

    #[test]
    fn empty_is_zero_parts() {
        assert_eq!(co_billing_parts(""), 0);
        assert_eq!(co_billing_parts("   "), 0);
    }

    #[test]
    fn multibyte_names_do_not_panic() {
        // The verbatim `lower[i..]` indexing is unsound for chars whose lowercase form differs in
        // byte length (Turkish dotted I is the classic). The real resolver has the same hazard;
        // the added is_char_boundary guard keeps this copy from panicking on a 2M-file run.
        for name in ["İstanbul Ãgents", "ÅÅÅ", "日本 & 中国", "Ø & Ñ"] {
            let _ = separator_positions(name);
            let _ = co_billing_parts(name);
        }
    }
}
