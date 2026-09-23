//! Title-comparison rules beyond plain equality, shared by the two places that decide whether a local
//! track *is* a MusicBrainz track: `boxset::pair_tracks_at` (is this folder that disc?) and
//! `status::check_release_status` (is this release complete?).
//!
//! They used to live only in `boxset`, which is how the two drifted apart: round 2 taught the box
//! matcher to pair "Market Square Heroes (alternative version)" with MusicBrainz's "Market Square Heroes
//! (re-record)", while the status scorer still could not - so Marillion's box folded with all 45 tracks
//! and was then scored `MISSING_TRACKS` (docs/specs/spec_tidy_observations.md §13). One definition, used by
//! both, keeps the two answers consistent.
//!
//! Both rules operate on `owned::normalize_title` output (alphanumerics only, lower-cased) - the
//! thresholds below were measured on that form.

/// Pass 4's bounds. A tagging typo is one or two characters; a genuinely different song scores far
/// below the floor. Both a ratio floor and an absolute edit cap apply - the cap is what stops a long
/// title from buying itself proportionally more slack.
pub(crate) const FUZZY_MIN_RATIO: f32 = 0.9;
pub(crate) const FUZZY_MAX_EDITS: usize = 3;

/// The title with any trailing parenthesised/bracketed qualifiers removed:
/// `"Market Square Heroes (re-record)"` -> `"Market Square Heroes"`. Repeats, so
/// `"Song (live) [remastered]"` reduces to `"Song"`.
///
/// Empty when the whole title is one bracketed group - there is no base title to compare in that case,
/// and comparing empty strings would match everything.
pub(crate) fn strip_qualifier(title: &str) -> String {
    let mut s = title.trim().to_string();
    loop {
        let chars: Vec<char> = s.chars().collect();
        let (open, close) = match chars.last() {
            Some(')') => ('(', ')'),
            Some(']') => ('[', ']'),
            _ => break,
        };
        let mut depth = 0i32;
        let mut opened_at = None;
        for (i, c) in chars.iter().enumerate().rev() {
            if *c == close {
                depth += 1;
            } else if *c == open {
                depth -= 1;
                if depth == 0 {
                    opened_at = Some(i);
                    break;
                }
            }
        }
        let Some(i) = opened_at else { break };
        let next: String = chars[..i].iter().collect::<String>().trim().to_string();
        if next.is_empty() {
            return String::new();
        }
        s = next;
    }
    s
}

/// Levenshtein distance, abandoned as soon as it is certain to exceed `max` - so this stays cheap on
/// the long titles where it would otherwise do the most work.
fn edit_distance_within(a: &str, b: &str, max: usize) -> Option<usize> {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.len().abs_diff(b.len()) > max {
        return None;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        let mut row_min = cur[0];
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            cur[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1);
            row_min = row_min.min(cur[j + 1]);
        }
        if row_min > max {
            return None;
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    let distance = prev[b.len()];
    (distance <= max).then_some(distance)
}

/// Two normalized titles close enough to be the same song typed differently.
///
/// Accepts `"sweetemalinamygal"`/`"sweetemalinemygal"` (0.94) and `"frearmsmash"`/`"forearmsmash"`
/// (0.92); refuses `"blessyourselfandthechildren"`/`"blessthebeastsandthechildren"` (~0.7, a
/// mondegreen of a different song) and `"two"`/`"three"` (0.2).
pub(crate) fn titles_near_identical(a: &str, b: &str) -> bool {
    let longest = a.chars().count().max(b.chars().count());
    if longest == 0 {
        return false;
    }
    match edit_distance_within(a, b, FUZZY_MAX_EDITS) {
        Some(distance) => 1.0 - (distance as f32 / longest as f32) >= FUZZY_MIN_RATIO,
        None => false,
    }
}

/// Tokens after which a bare roman numeral or number word is a number rather than a word - "Part I",
/// "Vol. Two". Without this context "I Must Get You" would read as containing the number 1.
const NUMBER_CONTEXT: &[&str] = &[
    "part", "parts", "pt", "vol", "volume", "no", "op", "opus", "act", "chapter", "movement",
    "book", "disc", "cd", "side", "suite", "take", "version", "v",
    // Same words in the other languages that turned up in the library ("Dove... quando..., parte I").
    "parte", "partie", "teil", "deel", "del",
];

/// Roman numerals that are unambiguous on their own. A single "i", "v" or "x" is not in this list - it
/// is far more often a word or an initial - and nor is anything using "l"/"c"/"d"/"m", which collide
/// with real words ("ill", "lil", "mix", "civil"). Those only count after a `NUMBER_CONTEXT` token.
const STANDALONE_ROMAN: &[(&str, u32)] = &[
    ("ii", 2),
    ("iii", 3),
    ("iv", 4),
    ("vi", 6),
    ("vii", 7),
    ("viii", 8),
    ("ix", 9),
    ("xi", 11),
    ("xii", 12),
    ("xiii", 13),
    ("xiv", 14),
    ("xv", 15),
    ("xvi", 16),
    ("xx", 20),
];

fn roman_value(token: &str) -> Option<u32> {
    match token {
        "i" => Some(1),
        "v" => Some(5),
        "x" => Some(10),
        _ => STANDALONE_ROMAN
            .iter()
            .find(|(r, _)| *r == token)
            .map(|(_, v)| *v),
    }
}

fn word_value(token: &str) -> Option<u32> {
    const WORDS: &[&str] = &[
        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
        "twelve",
    ];
    WORDS.iter().position(|w| *w == token).map(|i| i as u32 + 1)
}

/// Whether two titles name *different* numbers. Only a disagreement counts: a number present on one
/// side and absent from the other is extra specificity - a year ("(live in Minneapolis 1996)" against
/// "(live)"), an artist name ("(Prefuse 73's Pieces of Detroit mix)") - not a different piece. "(take
/// 10)" against "(take 4)", both numbered and different, is.
pub(crate) fn numbers_disagree(a: &str, b: &str) -> bool {
    let (na, nb) = (number_signature(a), number_signature(b));
    !na.is_empty() && !nb.is_empty() && na != nb
}

/// Every number a title names, in order, with the spellings of one number read as the same value:
/// "Part I", "Part 1" and "Part One" all give `[1]`; "Parts I–V" and "Parts 1-5" both give `[1, 5]`.
///
/// A number is identity, not spelling - "Part 2" and "Part 3" are different pieces however close the
/// strings are, and so are "(take 3)" and "(take 4)". The looser title rules refuse any pairing whose
/// signatures differ. Measured on the library before this existed: the typo rule had paired "Divine Opus
/// #1" with "Divine Opus 2", "Part 1" with "Part II", "V2" with "V1".
///
/// Roman numerals of two or more letters ("ii", "iv") always count; a single "i"/"v"/"x" and number words
/// only count after a `NUMBER_CONTEXT` token or directly after another number, so the pronoun "I" never
/// becomes a 1.
pub(crate) fn number_signature(title: &str) -> Vec<u32> {
    let lower = title.to_lowercase();
    let tokens: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
    let mut out = Vec::new();
    let mut previous_was_context = false;
    for token in tokens {
        let digit_runs: Vec<u32> = token
            .split(|c: char| !c.is_ascii_digit())
            .filter(|r| !r.is_empty())
            .filter_map(|r| r.parse().ok())
            .collect();
        let value = if !digit_runs.is_empty() {
            out.extend(digit_runs);
            previous_was_context = true;
            continue;
        } else if STANDALONE_ROMAN.iter().any(|(r, _)| *r == token) {
            roman_value(token)
        } else if previous_was_context {
            roman_value(token).or_else(|| word_value(token))
        } else {
            None
        };
        match value {
            Some(v) => {
                out.push(v);
                previous_was_context = true;
            }
            None => previous_was_context = NUMBER_CONTEXT.contains(&token),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spellings_of_one_number_share_a_signature() {
        assert_eq!(number_signature("Song to John, Part I"), vec![1]);
        assert_eq!(number_signature("Song to John, Part 1"), vec![1]);
        assert_eq!(
            number_signature("Garden Party, Part One - Entrance"),
            vec![1]
        );
        assert_eq!(
            number_signature("Shine On You Crazy Diamond, Parts I–V"),
            vec![1, 5]
        );
        assert_eq!(
            number_signature("Shine On You Crazy Diamond, Parts 1-5"),
            vec![1, 5]
        );
    }

    /// The pairings the typo rule made on the real library before this existed.
    #[test]
    fn different_numbers_give_different_signatures() {
        assert_ne!(
            number_signature("Divine Opus # 1"),
            number_signature("Divine Opus 2")
        );
        assert_ne!(
            number_signature("Chega de Saudade (No More Blues, Part 1)"),
            number_signature("Chega De Saudade = No More Blues-Part II")
        );
        assert_ne!(
            number_signature("Dream of a Discoteque V2"),
            number_signature("Dream of a Discoteque V1")
        );
        assert_ne!(
            number_signature("I'll Be Home (take 3)"),
            number_signature("I'll Be Home (take 4)")
        );
    }

    /// Words made of roman-numeral letters must not read as numbers.
    #[test]
    fn a_number_on_one_side_only_is_not_a_disagreement() {
        assert!(!numbers_disagree(
            "Amen / Inner Self (live)",
            "Amen/Inner Self (live in Minneapolis 1996)"
        ));
        assert!(!numbers_disagree(
            "Wife (Pieces of Detroit mix)",
            "Wife (Prefuse 73's Pieces of Detroit mix)"
        ));
        assert!(numbers_disagree(
            "Rip It Up (take 10)",
            "Rip It Up (take 4)"
        ));
        assert!(!numbers_disagree(
            "Dove... quando..., parte I",
            "Dove... quando..., Part I"
        ));
    }

    #[test]
    fn words_are_not_numbers() {
        assert!(
            number_signature("I Must Get You").is_empty(),
            "the pronoun I"
        );
        assert!(number_signature("Lil Wayne Is Ill").is_empty());
        assert!(number_signature("Remix (Civil Mix)").is_empty());
        assert!(number_signature("Vivid").is_empty());
    }
}
