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

/// Split an artist tag into (main_artists, featured_artists).
///
/// Splitting rules:
/// - Splits on "feat."/"ft."/"featuring" (case-insensitive) to separate featured artists
/// - Then splits each side by "/" "//" "\" "\\" "|" "||" ";"
/// - Splits on "vs." / "vs" (unambiguous collaboration marker)
/// - Does NOT split on "," (preserves "10,000 Maniacs", "Crosby, Stills & Nash")
/// - Does NOT split on "&" (too ambiguous: "Simon & Garfunkel")
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

    let split_part = |s: &str| -> Vec<String> {
        vs_re.split(s).flat_map(|seg| split_by_chars(seg)).collect()
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
