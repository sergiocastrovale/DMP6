use cuid2::create_id;
use regex::Regex;
use sqlx::PgPool;
use std::sync::LazyLock;

const KNOWN_SINGLE: &[&str] = &[
    "ac/dc", "acdc",
    "kool & the gang", "kool and the gang",
    "simon & garfunkel", "simon and garfunkel",
    "hall & oates", "hall and oates",
    "earth, wind & fire", "earth wind and fire",
    "crosby, stills & nash", "crosby stills and nash",
    "crosby, stills, nash & young",
    "sly & the family stone",
    "emerson, lake & palmer",
    "blood, sweat & tears",
    "sleeping with sirens",
    "dancing with the dead",
    "flirting with disaster",
];

static RE_FEAT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i) feat\. ").unwrap());
static RE_VS_DOT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i) vs\. ").unwrap());
static RE_VS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i) vs ").unwrap());
static RE_WITH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i) with ").unwrap());
static RE_WITH_QUALIFIER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(special\s+guests?|guests?|orchestra\s+(?:conducted|directed)\s+by|arranged\s+and\s+conducted\s+by)\s+").unwrap()
});
static RE_CONDUCTOR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i),\s*(?:orchestra\s+conducted\s+by|orchestra\s+directed\s+by|arranged\s+and\s+conducted\s+by|conducted\s+by|directed\s+by)\s+").unwrap()
});

fn is_known_single(name: &str) -> bool {
    let lower = name.to_lowercase();
    KNOWN_SINGLE.iter().any(|s| lower == *s)
}

fn split_ignoring_numeric_commas(name: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = name.chars().collect();

    for i in 0..chars.len() {
        if chars[i] == ',' {
            let before_is_digit = i > 0 && chars[i - 1].is_ascii_digit();
            let after_is_digit = i + 1 < chars.len() && chars[i + 1].is_ascii_digit();
            if before_is_digit && after_is_digit {
                current.push(chars[i]);
            } else {
                parts.push(current.clone());
                current.clear();
            }
        } else {
            current.push(chars[i]);
        }
    }
    parts.push(current);
    parts
}

/// Split on " with ", stripping a leading role qualifier ("special guests", "orchestra conducted by",
/// ...) off each side, then sub-splitting any side that still has a comma/& list. Mirrors
/// `common::artists::split_artists`'s "with" handling - see that function's doc comment for why " with "
/// is treated as the outermost separator.
fn split_with(name: &str) -> Vec<String> {
    RE_WITH
        .split(name)
        .flat_map(|part| {
            let stripped = RE_WITH_QUALIFIER.replace(part.trim(), "").trim().to_string();
            if stripped.contains(" & ") && stripped.contains(',') {
                split_ignoring_numeric_commas(&stripped)
                    .into_iter()
                    .flat_map(|chunk| chunk.split(" & ").map(|s| s.trim().to_string()).collect::<Vec<_>>())
                    .collect::<Vec<_>>()
            } else if stripped.contains(" & ") {
                stripped.split(" & ").map(|s| s.trim().to_string()).collect()
            } else {
                vec![stripped]
            }
        })
        .filter(|s| !s.is_empty())
        .collect()
}

fn detect_separator(name: &str) -> Option<(&'static str, Vec<String>)> {
    if RE_FEAT.is_match(name) {
        let parts: Vec<String> = RE_FEAT
            .split(name)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() > 1 {
            return Some(("feat.", parts));
        }
    }

    if RE_VS_DOT.is_match(name) {
        let parts: Vec<String> = RE_VS_DOT
            .split(name)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() > 1 {
            return Some(("vs.", parts));
        }
    }

    // Check " vs " only when " vs. " is not present (avoids double-matching)
    if RE_VS.is_match(name) && !RE_VS_DOT.is_match(name) {
        let parts: Vec<String> = RE_VS
            .split(name)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() > 1 {
            return Some(("vs", parts));
        }
    }

    // Checked before the "&"/",&" rules below: every observed "with" case nests its & / comma list
    // INSIDE the "with" clause (e.g. "... with special guests Carey Bell & Sunnyland Slim"), so "with"
    // must win precedence or the plain "&" rule would split mid-clause.
    if RE_WITH.is_match(name) {
        let parts = split_with(name);
        if parts.len() > 1 {
            return Some(("with", parts));
        }
    }

    if RE_CONDUCTOR.is_match(name) {
        let parts: Vec<String> = RE_CONDUCTOR
            .split(name)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() > 1 {
            return Some(("conducted by", parts));
        }
    }

    if name.contains('\\') {
        let parts: Vec<String> = name
            .split('\\')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() > 1 {
            return Some(("\\", parts));
        }
    }

    if name.contains(" & ") && name.contains(',') {
        let parts: Vec<String> = split_ignoring_numeric_commas(name)
            .into_iter()
            .flat_map(|chunk| chunk.split(" & ").map(|s| s.to_string()).collect::<Vec<_>>())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() > 2 {
            return Some((",&", parts));
        }
    }

    if name.contains(" & ") {
        let parts: Vec<String> = name.split(" & ").map(|s| s.trim().to_string()).collect();
        if parts.len() > 1 {
            return Some(("&", parts));
        }
    }

    if name.contains(" / ") {
        let parts: Vec<String> = name.split(" / ").map(|s| s.trim().to_string()).collect();
        if parts.len() > 1 {
            return Some(("/", parts));
        }
    }

    if name.contains("; ") {
        let parts: Vec<String> = name.split("; ").map(|s| s.trim().to_string()).collect();
        if parts.len() > 1 {
            return Some((";", parts));
        }
    }

    None
}

pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueUnsplitArtist" WHERE status = 'DETECTED'"#)
        .execute(pool)
        .await?;

    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT id, name FROM "Artist"
           WHERE name LIKE '% & %'
              OR name ILIKE '% feat. %'
              OR name ILIKE '% vs %'
              OR name ILIKE '% vs. %'
              OR name LIKE '% / %'
              OR name LIKE '%; %'
              OR name ILIKE '% with %'
              OR name ILIKE '%conducted by%'
              OR name ILIKE '%arranged and conducted%'
              OR strpos(name, '\') > 0"#,
    )
    .fetch_all(pool)
    .await?;

    let mut inserted = 0usize;

    for (artist_id, name) in &rows {
        if is_known_single(name) {
            continue;
        }
        let Some((separator, parts)) = detect_separator(name) else {
            continue;
        };
        if parts.len() < 2 {
            continue;
        }

        let already_tracked: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM "IssueUnsplitArtist"
               WHERE "artistId" = $1 AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED'))"#,
        )
        .bind(artist_id)
        .fetch_one(pool)
        .await?;
        if already_tracked {
            continue;
        }

        let id = create_id();
        let now = chrono::Utc::now().naive_utc();
        let parts_arr: Vec<&str> = parts.iter().map(|s| s.as_str()).collect();

        sqlx::query(
            r#"INSERT INTO "IssueUnsplitArtist"
               (id, "auditRunId", status, "artistId", separator, "proposedParts", "createdAt", "updatedAt")
               VALUES ($1, $2, 'DETECTED', $3, $4, $5, $6, $6)"#,
        )
        .bind(&id)
        .bind(run_id)
        .bind(artist_id)
        .bind(separator)
        .bind(&parts_arr)
        .bind(now)
        .execute(pool)
        .await?;

        inserted += 1;
    }

    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_with() {
        let (sep, parts) = detect_separator("Frank Sinatra with Count Basie").unwrap();
        assert_eq!(sep, "with");
        assert_eq!(parts, vec!["Frank Sinatra", "Count Basie"]);
    }

    #[test]
    fn with_wins_over_ampersand() {
        let (sep, parts) = detect_separator("Frank Sinatra with Billy May & His Orchestra").unwrap();
        assert_eq!(sep, "with");
        assert_eq!(parts, vec!["Frank Sinatra", "Billy May", "His Orchestra"]);
    }

    #[test]
    fn with_strips_qualifiers() {
        let (_, parts) = detect_separator(
            "The Eddie Taylor Blues Band with special guests Carey Bell & Sunnyland Slim",
        )
        .unwrap();
        assert_eq!(parts, vec!["The Eddie Taylor Blues Band", "Carey Bell", "Sunnyland Slim"]);
    }

    #[test]
    fn with_known_single_skipped() {
        assert!(is_known_single("Sleeping With Sirens"));
    }

    #[test]
    fn splits_conducted_by() {
        let (sep, parts) = detect_separator("Frank Sinatra, orchestra conducted by Nelson Riddle").unwrap();
        assert_eq!(sep, "conducted by");
        assert_eq!(parts, vec!["Frank Sinatra", "Nelson Riddle"]);
    }

    #[test]
    fn splits_backslash() {
        let (sep, parts) = detect_separator("B.B. King\\Bobby Bland").unwrap();
        assert_eq!(sep, "\\");
        assert_eq!(parts, vec!["B.B. King", "Bobby Bland"]);
    }

    #[test]
    fn no_false_positive_on_plain_name() {
        assert!(detect_separator("Bill Withers").is_none());
        assert!(detect_separator("Jimmy Witherspoon").is_none());
    }
}
