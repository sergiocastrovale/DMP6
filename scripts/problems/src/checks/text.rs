//! Character-level predicates over raw tag values.
//!
//! Every function here is pure and allocation-light: they run once per tag per file, millions of
//! times per scan. None of them use regex - a hand-written `char` scan is both faster and easier to
//! reason about at the boundaries, and the boundaries are where all the false positives live.

/// True when the value contains characters but every one of them is whitespace.
///
/// An absent tag is not "whitespace-only" - that is a different (and more severe) defect - so `""`
/// returns false. Note this covers U+00A0 NBSP, because `char::is_whitespace` does; it does *not*
/// cover zero-width characters, which is why [`invisible_chars`] exists separately.
pub fn is_whitespace_only(s: &str) -> bool {
    !s.is_empty() && s.chars().all(char::is_whitespace)
}

/// True when the value has no letters and no digits in any script.
///
/// This is the condition that makes `common::slug::make_slug` fall back to `artist-<md5>`, which
/// produces an artist row that cannot be browsed to. CJK, Cyrillic and accented Latin are all
/// alphanumeric, so real names in any script are never flagged.
pub fn is_punctuation_only(s: &str) -> bool {
    !s.trim().is_empty() && !s.chars().any(char::is_alphanumeric)
}

/// True when the value differs from its own trimmed form.
pub fn is_untrimmed(s: &str) -> bool {
    !s.is_empty() && s.trim() != s
}

/// Invisible or otherwise undisplayable characters that silently fork an artist into two rows.
///
/// These all render as nothing (or as a normal space) in a tag editor, so a name carrying one looks
/// byte-identical to the clean version while slugging and comparing differently.
pub fn invisible_chars(s: &str) -> Vec<char> {
    let mut found: Vec<char> = Vec::new();
    for c in s.chars() {
        let bad = matches!(c,
            '\u{0}'..='\u{8}'
            | '\u{B}'..='\u{1F}'
            | '\u{7F}'..='\u{9F}'
            | '\u{A0}'          // no-break space
            | '\u{00AD}'        // soft hyphen
            | '\u{200B}'..='\u{200F}' // zero-width space/joiners, LRM/RLM
            | '\u{2028}' | '\u{2029}'
            | '\u{202A}'..='\u{202E}' // bidi overrides
            | '\u{2060}'        // word joiner
            | '\u{FEFF}'        // BOM used mid-string
            | '\u{FFFD}'        // replacement char: something already decoded wrongly
        );
        if bad && !found.contains(&c) {
            found.push(c);
        }
    }
    found
}

/// The 27 characters that CP1252 maps into the 0x80..=0x9F range where Latin-1 has controls.
///
/// A UTF-8 continuation byte in that range surfaces as one of these when text is mis-decoded as
/// CP1252, which is why `â€™` (U+00E2 U+20AC U+2122) is the single most common mojibake signature.
const CP1252_HIGH: &[char] = &[
    '\u{20AC}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}', '\u{02C6}',
    '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{017D}', '\u{2018}', '\u{2019}', '\u{201C}',
    '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}', '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}',
    '\u{0153}', '\u{017E}', '\u{0178}',
];

/// True when the value looks like UTF-8 that was decoded as Latin-1 or CP1252 ("mojibake").
///
/// Detection is **structural**, not a blocklist of known-bad substrings. UTF-8 encodes non-ASCII
/// characters as a lead byte in 0xC2..=0xF4 followed by continuation bytes in 0x80..=0xBF.
/// Mis-decoded as a single-byte charset, the lead byte surfaces as a char in U+00C2..=U+00F4 and
/// each continuation byte as either U+0080..=U+00BF (Latin-1) or one of [`CP1252_HIGH`].
///
/// The lead range must span the 3-byte forms too, not just the 2-byte ones: `â€™` - by far the most
/// common signature in real libraries, from a mis-decoded U+2019 apostrophe - starts at U+00E2,
/// which comes from the 3-byte lead 0xE2.
///
/// Requiring the pair to be *adjacent* is what keeps false positives away. `Motörhead` has a lead-
/// range char (`ö`, U+00F6) but it is followed by `r`, so it never fires. A substring blocklist
/// would need endless exceptions to achieve the same thing.
pub fn looks_like_mojibake(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    for pair in chars.windows(2) {
        let (lead, next) = (pair[0], pair[1]);
        let is_lead = ('\u{00C2}'..='\u{00F4}').contains(&lead);
        if !is_lead {
            continue;
        }
        let is_follow = ('\u{0080}'..='\u{00BF}').contains(&next) || CP1252_HIGH.contains(&next);
        if is_follow {
            return true;
        }
    }
    false
}

/// Render a char list for the report: `U+00A0, U+200B`.
pub fn describe_chars(chars: &[char]) -> String {
    chars
        .iter()
        .map(|c| format!("U+{:04X}", *c as u32))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitespace_only_distinguishes_empty_from_blank() {
        assert!(
            !is_whitespace_only(""),
            "absent is a different defect from blank"
        );
        assert!(is_whitespace_only(" "));
        assert!(is_whitespace_only("\t\n"));
        assert!(
            is_whitespace_only("\u{00A0}"),
            "NBSP is char::is_whitespace"
        );
        assert!(!is_whitespace_only("a"));
        // The surprising one, and precisely why invisible_chars() has to exist as a separate
        // check: a zero-width space is NOT whitespace as far as Rust is concerned.
        assert!(!is_whitespace_only("\u{200B}"));
    }

    #[test]
    fn punctuation_only_spares_every_script() {
        assert!(is_punctuation_only("---"));
        assert!(is_punctuation_only("..."));
        assert!(is_punctuation_only("???"));
        assert!(is_punctuation_only("[]"));
        assert!(!is_punctuation_only(""));
        assert!(!is_punctuation_only("A"));
        assert!(!is_punctuation_only("2Pac"));
        // Non-Latin scripts are alphanumeric and must never be called junk.
        assert!(!is_punctuation_only("日本"));
        assert!(!is_punctuation_only("Дискотека"));
        assert!(!is_punctuation_only("Björk"));
    }

    #[test]
    fn untrimmed_detects_both_ends() {
        assert!(is_untrimmed(" Various Artists"));
        assert!(is_untrimmed("Radiohead "));
        assert!(!is_untrimmed("Radiohead"));
        assert!(!is_untrimmed(""));
    }

    #[test]
    fn invisible_chars_finds_the_silent_forkers() {
        assert_eq!(invisible_chars("Bj\u{00A0}rk"), vec!['\u{00A0}']);
        assert_eq!(invisible_chars("a\u{200B}b"), vec!['\u{200B}']);
        assert_eq!(invisible_chars("\u{FEFF}x"), vec!['\u{FEFF}']);
        assert_eq!(invisible_chars("x\u{FFFD}"), vec!['\u{FFFD}']);
        assert!(invisible_chars("Radiohead").is_empty());
        assert!(invisible_chars("Sigur Rós").is_empty());
        assert!(invisible_chars("日本").is_empty());
    }

    #[test]
    fn invisible_chars_dedupes() {
        assert_eq!(invisible_chars("a\u{200B}b\u{200B}c"), vec!['\u{200B}']);
    }

    #[test]
    fn mojibake_detects_real_mis_decodes() {
        // "é" (U+00E9) as UTF-8 is C3 A9; read as CP1252 that is "Ã©".
        assert!(looks_like_mojibake("Ã©"));
        assert!(looks_like_mojibake("Ã¤"));
        assert!(looks_like_mojibake("Sigur RÃ³s"));
        assert!(looks_like_mojibake("Ã‰dith Piaf"));
        // "'" (U+2019) as UTF-8 is E2 80 99; read as CP1252 that is "â€™".
        assert!(looks_like_mojibake("Rockâ€™n Roll"));
        assert!(looks_like_mojibake("Ã‚Â"));
    }

    #[test]
    fn mojibake_does_not_fire_on_legitimate_names() {
        // This is the test that decides whether the report is usable. A mojibake check that
        // flags Motörhead makes every row suspect.
        for name in [
            "Björk",
            "Sigur Rós",
            "Édith Piaf",
            "Motörhead",
            "Beyoncé",
            "Café Tacvba",
            "Mötley Crüe",
            "Blue Öyster Cult",
            "Häxan",
            "日本",
            "Дискотека Авария",
            "AC/DC",
            "Simon & Garfunkel",
            "",
            "Ñ",
            "Ø",
        ] {
            assert!(
                !looks_like_mojibake(name),
                "false positive on legitimate name: {name}"
            );
        }
    }

    #[test]
    fn describe_chars_formats_codepoints() {
        assert_eq!(describe_chars(&['\u{A0}', '\u{200B}']), "U+00A0, U+200B");
        assert_eq!(describe_chars(&[]), "");
    }
}
