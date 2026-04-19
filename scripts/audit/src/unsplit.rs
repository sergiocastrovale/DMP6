use cuid2::create_id;
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
];

static RE_FEAT: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i) feat\. ").unwrap());
static RE_VS_DOT: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i) vs\. ").unwrap());
static RE_VS: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i) vs ").unwrap());

fn is_known_single(name: &str) -> bool {
    let lower = name.to_lowercase();
    KNOWN_SINGLE.iter().any(|s| lower == *s)
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
    sqlx::query(r#"DELETE FROM "IssueUnsplitArtist""#)
        .execute(pool)
        .await?;

    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT id, name FROM "Artist"
           WHERE name LIKE '% & %'
              OR name ILIKE '% feat. %'
              OR name ILIKE '% vs %'
              OR name ILIKE '% vs. %'
              OR name LIKE '% / %'
              OR name LIKE '%; %'"#,
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
