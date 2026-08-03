use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

pub const SPECIAL_MB_ARTIST_IDS: &[&str] = &[
    "89ad4ac3-39f7-470e-963a-56509c546377", // Various Artists
    "f731ccc4-e22a-43af-a747-64213329e088", // [anonymous]
    "33cf029c-63b0-41a0-9855-be2a3665fb3b", // [data]
    "314e1c25-dde7-4e4d-b2f4-0a7b032fa3c6", // [dialogue]
    "eec63d3c-3b81-4ad4-b1e4-7c147c4d2b61", // [no artist]
    "125ec42a-7229-4250-afc5-e057484327fe", // [traditional]
    "9be7f096-97ec-4615-8957-8c3b0b15e4e0", // [unknown]
];

/// Replace `from` with `to` in `tag`, but only on a whole-word (case-insensitive) match - not a bare
/// substring. Used by duplicate-artist merge to rewrite embedded tags: a naive `str::replace` would
/// turn "Amused" into garbage when merging an artist named "Muse" (substring match), and would miss
/// "MUSE" entirely (case-sensitive). `\b` word boundaries fix both without needing to know the tag's
/// separator style (comma/&/feat./etc.).
pub fn replace_artist_word(tag: &str, from: &str, to: &str) -> String {
    if from.is_empty() {
        return tag.to_string();
    }
    let pattern = format!(r"(?i)\b{}\b", regex::escape(from));
    let Ok(re) = Regex::new(&pattern) else {
        return tag.to_string();
    };
    let escaped_to = to.replace('$', "$$"); // regex replacement syntax treats $ specially
    re.replace_all(tag, escaped_to.as_str()).to_string()
}

pub fn is_various_artists(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "various artists"
        || lower == "various"
        || lower == "va"
        || lower.starts_with("various artists,")
        || lower.starts_with("various artists &")
        || lower.starts_with("various artists /")
}

pub fn is_special_artist_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    is_various_artists(name) || lower == "unknown" || lower == "[unknown]"
}

pub fn is_special_mb_artist(id: &str, name: &str) -> bool {
    SPECIAL_MB_ARTIST_IDS.contains(&id) || is_special_artist_name(name)
}

/// Bands whose own name contains what would otherwise look like a separator. This is a **backstop**,
/// not the authority - `common::mb::resolve` asks MusicBrainz first and only consults this list to keep
/// a definitive "no such artist" answer from shredding a band the codebase already knows about. It does
/// not need to be exhaustive, and entries here are never a reason to skip the MB lookup.
pub const KNOWN_SINGLE_ARTISTS: &[&str] = &[
    // & bands
    "simon & garfunkel",
    "kool & the gang",
    "hall & oates",
    "daryl hall & john oates",
    "sly & the family stone",
    "belle & sebastian",
    "nick cave & the bad seeds",
    "echo & the bunnymen",
    "bob marley & the wailers",
    "prince & the revolution",
    "katrina & the waves",
    "josie & the pussycats",
    "derek & the dominos",
    "iggy & the stooges",
    "joan jett & the blackhearts",
    "mike & the mechanics",
    "huey lewis & the news",
    "the mamas & the papas",
    "mumford & sons",
    "florence & the machine",
    "ty segall & the muggers",
    "ty segall & white fence",
    "hootie & the blowfish",
    "country joe & the fish",
    "siouxsie & the banshees",
    "tom petty & the heartbreakers",
    "the captain & tennille",
    "ike & tina turner",
    "peaches & herb",
    "sam & dave",
    "ferrante & teicher",
    "santo & johnny",
    "loggins & messina",
    "seals & crofts",
    "england dan & john ford coley",
    "brooks & dunn",
    "big & rich",
    "for king & country",
    "above & beyond",
    "angus & julia stone",
    "tegan & sara",
    "she & him",
    "chas & dave",
    "matt & kim",
    "chase & status",
    "wendy & lisa",
    "ashford & simpson",
    "timbaland & magoo",
    "eric b. & rakim",
    "dj jazzy jeff & the fresh prince",
    "mel & kim",
    "robert randolph & the family band",
    "cedric gervais & cid",
    "armed & dangerous",
    "bob & earl",
    "mel & tim",
    "zager & evans",
    // "with" bands
    "sleeping with sirens",
    "dancing with the dead",
    "flirting with disaster",
    "nurse with wound",
    "man with a mission",
    "dance with the dead",
    "ends with a bullet",
    "tom petty and the heartbreakers",
    // comma bands
    "earth, wind & fire",
    "crosby, stills & nash",
    "crosby, stills, nash & young",
    "emerson, lake & palmer",
    "blood, sweat & tears",
    "peter, paul & mary",
    "peter, bjorn & john",
    // slash/semicolon bands
    "ac/dc",
];

/// Whole-name match against `KNOWN_SINGLE_ARTISTS`, compared on the normalized form so one entry
/// covers every punctuation variant of the same band - "Florence + the Machine", "Florence & The
/// Machine" and "florence and the machine" all normalize alike.
pub fn is_known_single_artist(name: &str) -> bool {
    let n = crate::mb::names::normalize_name(name);
    if n.is_empty() {
        return false;
    }
    KNOWN_SINGLE_ARTISTS
        .iter()
        .any(|k| crate::mb::names::normalize_name(k) == n)
}

fn split_ignoring_numeric_commas(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = s.chars().collect();
    for i in 0..chars.len() {
        if chars[i] == ',' {
            let before_digit = i > 0 && chars[i - 1].is_ascii_digit();
            let after_digit = i + 1 < chars.len() && chars[i + 1].is_ascii_digit();
            if before_digit && after_digit {
                current.push(',');
            } else {
                parts.push(current.trim().to_string());
                current.clear();
            }
        } else {
            current.push(chars[i]);
        }
    }
    parts.push(current.trim().to_string());
    parts.into_iter().filter(|s| !s.is_empty()).collect()
}

/// Split an artist tag into (main_artists, featured_artists).
///
/// Splitting rules:
/// - Splits on "feat."/"ft."/"featuring" (case-insensitive) to separate featured artists
/// - Splits on ", " (comma+space), preserving numeric commas (10,000)
/// - Splits on " & " (ampersand with spaces)
/// - Splits on "/" "//" "\" "\\" "|" "||" ";"
/// - Splits on "vs." / "vs" (unambiguous collaboration marker)
/// - Splits on " with " (space-bounded credit marker: "Frank Sinatra with Count Basie"), stripping a
///   leading role qualifier ("special guests", "guest", "orchestra conducted/directed by", "arranged
///   and conducted by") off the right-hand side first
/// - Respects KNOWN_SINGLE_ARTISTS (bands with ,/&/with in their name) - guard is whole-tag only, same
///   scope as the existing & and comma handling: a known band combined with another artist via a
///   different separator (e.g. "Sleeping With Sirens, Pierce The Veil") is not protected, matching how
///   "Simon & Garfunkel, Nash" already isn't either
pub fn split_artists(tag: &str) -> (Vec<String>, Vec<String>) {
    static FEAT_RE: OnceLock<Regex> = OnceLock::new();
    let feat_re = FEAT_RE.get_or_init(|| {
        Regex::new(r"(?i)\s*\(\s*feat(?:uring)?\.?\s+|\s+feat(?:uring)?\.?\s+|\s*\(\s*ft\.?\s+|\s+ft\.?\s+").unwrap()
    });

    let (main_part, feat_part) = if let Some(m) = feat_re.find(tag) {
        let main = &tag[..m.start()];
        let mut feat = &tag[m.end()..];
        if tag[m.start()..m.end()].contains('(') {
            feat = feat.trim_end_matches(')').trim();
        }
        (main.to_string(), Some(feat.to_string()))
    } else {
        (tag.to_string(), None)
    };

    // Character-level splitter: // \\ || always split; ; | always split;
    // single / and \ only split with surrounding spaces (" / " but not "AC/DC")
    let split_by_chars = |s: &str| -> Vec<String> {
        let mut parts: Vec<String> = Vec::new();
        let mut current = String::new();
        let chars: Vec<char> = s.chars().collect();
        let len = chars.len();
        let mut i = 0;
        while i < len {
            let c = chars[i];
            if i + 1 < len {
                let d = chars[i + 1];
                if (c == '/' && d == '/') || (c == '\\' && d == '\\') || (c == '|' && d == '|') {
                    parts.push(current.trim().to_string());
                    current = String::new();
                    i += 2;
                    continue;
                }
            }
            if c == ';' || c == '|' {
                parts.push(current.trim().to_string());
                current = String::new();
            } else if (c == '/' || c == '\\')
                && current.ends_with(' ')
                && (i + 1 < len && chars[i + 1] == ' ')
            {
                parts.push(current.trim().to_string());
                current = String::new();
            } else {
                current.push(c);
            }
            i += 1;
        }
        parts.push(current.trim().to_string());
        parts
            .into_iter()
            .filter(|p| !p.is_empty() && !is_special_artist_name(p))
            .collect()
    };

    static VS_RE: OnceLock<Regex> = OnceLock::new();
    let vs_re = VS_RE.get_or_init(|| Regex::new(r"(?i)\s+vs\.?\s+").unwrap());

    static WITH_RE: OnceLock<Regex> = OnceLock::new();
    let with_re = WITH_RE.get_or_init(|| Regex::new(r"(?i)\s+with\s+").unwrap());

    // Role qualifier left dangling on the right-hand side of a " with " split - e.g. "... with special
    // guests Carey Bell & Sunnyland Slim" or "... with orchestra directed by Morris Stoloff". Stripped
    // before that side re-enters the comma/&/vs pipeline, so the names underneath still get split.
    static QUALIFIER_RE: OnceLock<Regex> = OnceLock::new();
    let qualifier_re = QUALIFIER_RE.get_or_init(|| {
        Regex::new(r"(?i)^(special\s+guests?|guests?|orchestra\s+(?:conducted|directed)\s+by|arranged\s+and\s+conducted\s+by)\s+").unwrap()
    });

    // " with " is treated as the outermost separator (applied to the whole segment before comma/&/vs),
    // since every observed case nests the & / comma list INSIDE the "with" clause, never the reverse.
    let split_with = |s: &str| -> Vec<String> {
        if with_re.is_match(s) {
            with_re
                .split(s)
                .map(|p| qualifier_re.replace(p.trim(), "").trim().to_string())
                .collect()
        } else {
            vec![s.to_string()]
        }
    };

    let split_part = |s: &str| -> Vec<String> {
        if is_known_single_artist(s) {
            return vec![s.trim().to_string()];
        }
        split_with(s)
            .into_iter()
            .flat_map(|chunk| split_ignoring_numeric_commas(&chunk))
            .flat_map(|chunk| {
                chunk
                    .split(" & ")
                    .map(|p| p.trim().to_string())
                    .collect::<Vec<_>>()
            })
            .flat_map(|seg| vs_re.split(&seg).map(|p| p.to_string()).collect::<Vec<_>>())
            .flat_map(|seg| split_by_chars(&seg))
            .filter(|p| !p.is_empty())
            .collect()
    };

    let mut main_artists = split_part(&main_part);
    {
        let mut seen = HashSet::new();
        main_artists.retain(|a| seen.insert(a.to_lowercase()));
    }

    let mut featured_artists = match feat_part {
        Some(ref fp) => split_part(fp),
        None => Vec::new(),
    };
    {
        let main_lower: HashSet<String> = main_artists.iter().map(|a| a.to_lowercase()).collect();
        let mut seen = HashSet::new();
        featured_artists.retain(|a| {
            let lower = a.to_lowercase();
            !main_lower.contains(&lower) && seen.insert(lower)
        });
    }

    (main_artists, featured_artists)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_comma_and_ampersand() {
        let (m, f) = split_artists("R.E.M., Opal, Steve Wynn & 10,000 Maniacs");
        assert_eq!(m, vec!["R.E.M.", "Opal", "Steve Wynn", "10,000 Maniacs"]);
        assert!(f.is_empty());
    }

    #[test]
    fn preserves_numeric_comma() {
        let (m, _) = split_artists("10,000 Maniacs");
        assert_eq!(m, vec!["10,000 Maniacs"]);
    }

    #[test]
    fn known_single_preserved() {
        let (m, _) = split_artists("Crosby, Stills & Nash");
        assert_eq!(m, vec!["Crosby, Stills & Nash"]);

        let (m, _) = split_artists("Simon & Garfunkel");
        assert_eq!(m, vec!["Simon & Garfunkel"]);

        let (m, _) = split_artists("Earth, Wind & Fire");
        assert_eq!(m, vec!["Earth, Wind & Fire"]);

        let (m, _) = split_artists("Nick Cave & The Bad Seeds");
        assert_eq!(m, vec!["Nick Cave & The Bad Seeds"]);
    }

    #[test]
    fn splits_ampersand() {
        let (m, _) = split_artists("Daft Punk & Pharrell Williams");
        assert_eq!(m, vec!["Daft Punk", "Pharrell Williams"]);
    }

    #[test]
    fn feat_still_works() {
        let (m, f) = split_artists("Daft Punk feat. Pharrell Williams");
        assert_eq!(m, vec!["Daft Punk"]);
        assert_eq!(f, vec!["Pharrell Williams"]);
    }

    #[test]
    fn no_separator() {
        let (m, _) = split_artists("Air");
        assert_eq!(m, vec!["Air"]);
    }

    #[test]
    fn splits_with() {
        let (m, _) = split_artists("Frank Sinatra with Count Basie");
        assert_eq!(m, vec!["Frank Sinatra", "Count Basie"]);

        let (m, _) = split_artists("B.B. King with Eric Clapton");
        assert_eq!(m, vec!["B.B. King", "Eric Clapton"]);
    }

    #[test]
    fn with_strips_qualifiers() {
        let (m, _) = split_artists("Adelaide Hall with Guest Benny Waters");
        assert_eq!(m, vec!["Adelaide Hall", "Benny Waters"]);

        let (m, _) =
            split_artists("Bing Crosby and Al Jolson with orchestra directed by Morris Stoloff");
        assert_eq!(m, vec!["Bing Crosby and Al Jolson", "Morris Stoloff"]);

        let (m, _) = split_artists(
            "The Eddie Taylor Blues Band with special guests Carey Bell & Sunnyland Slim",
        );
        assert_eq!(
            m,
            vec![
                "The Eddie Taylor Blues Band",
                "Carey Bell",
                "Sunnyland Slim"
            ]
        );
    }

    #[test]
    fn with_does_not_split_names_containing_the_substring() {
        let (m, _) = split_artists("Bill Withers");
        assert_eq!(m, vec!["Bill Withers"]);

        let (m, _) = split_artists("Jimmy Witherspoon");
        assert_eq!(m, vec!["Jimmy Witherspoon"]);

        let (m, _) = split_artists("mewithoutYou");
        assert_eq!(m, vec!["mewithoutYou"]);

        let (m, _) = split_artists("And Hell Followed With");
        assert_eq!(m, vec!["And Hell Followed With"]);
    }

    #[test]
    fn with_known_single_preserved() {
        let (m, _) = split_artists("Sleeping With Sirens");
        assert_eq!(m, vec!["Sleeping With Sirens"]);
    }

    #[test]
    fn replace_artist_word_matches_whole_word_only() {
        assert_eq!(
            replace_artist_word("Muse", "Muse", "Matthew Bellamy"),
            "Matthew Bellamy"
        );
        // "Muse" is a substring of "Amused" but not a whole word - must be left untouched.
        assert_eq!(
            replace_artist_word("Amused", "Muse", "Matthew Bellamy"),
            "Amused"
        );
    }

    #[test]
    fn replace_artist_word_is_case_insensitive() {
        assert_eq!(
            replace_artist_word("MUSE", "Muse", "Matthew Bellamy"),
            "Matthew Bellamy"
        );
        assert_eq!(
            replace_artist_word("muse", "Muse", "Matthew Bellamy"),
            "Matthew Bellamy"
        );
    }

    #[test]
    fn replace_artist_word_works_within_a_multi_artist_tag() {
        assert_eq!(
            replace_artist_word("Muse & Radiohead", "Muse", "Matthew Bellamy"),
            "Matthew Bellamy & Radiohead"
        );
    }

    #[test]
    fn replace_artist_word_leaves_unrelated_tags_untouched() {
        assert_eq!(
            replace_artist_word("Radiohead", "Muse", "Matthew Bellamy"),
            "Radiohead"
        );
    }
}
