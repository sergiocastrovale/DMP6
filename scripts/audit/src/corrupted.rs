use cuid2::create_id;
use sqlx::PgPool;
use std::sync::LazyLock;

static DIGIT_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^\d{1,3}$").unwrap());

pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    sqlx::query(r#"DELETE FROM "IssueCorruptedTpe2""#)
        .execute(pool)
        .await?;

    let rows: Vec<(String, String, Option<String>, Option<i32>)> = sqlx::query_as(
        r#"SELECT id, COALESCE("albumArtist", ''), "localReleaseId", year
           FROM "LocalReleaseTrack"
           WHERE ("albumArtist" ~ '^\d{1,3}$'
              OR "albumArtist" ~ '^\d{1,3}\s*-\s*\S'
              OR "albumArtist" ~ '@\d{2,3}$'
              OR "albumArtist" ILIKE '%lbumArtist/%'
              OR (year IS NOT NULL AND "albumArtist" = year::text))
             AND "albumArtist" IS NOT NULL
             AND "albumArtist" != ''"#,
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(0);
    }

    let mut inserted = 0usize;

    for (track_id, current_value, release_id, year) in &rows {
        let (proposed_value, confidence) = find_proposed(pool, track_id, release_id.as_deref(), *year).await?;

        if proposed_value.is_empty() || proposed_value == *current_value {
            continue;
        }

        let id = create_id();
        let now = chrono::Utc::now().naive_utc();
        sqlx::query(
            r#"INSERT INTO "IssueCorruptedTpe2"
               (id, "auditRunId", status, "trackId", "currentValue", "proposedValue", confidence, "createdAt", "updatedAt")
               VALUES ($1, $2, 'DETECTED', $3, $4, $5, $6, $7, $7)"#,
        )
        .bind(&id)
        .bind(run_id)
        .bind(track_id)
        .bind(current_value)
        .bind(&proposed_value)
        .bind(&confidence)
        .bind(now)
        .execute(pool)
        .await?;

        inserted += 1;
    }

    Ok(inserted)
}

async fn find_proposed(
    pool: &PgPool,
    track_id: &str,
    release_id: Option<&str>,
    year: Option<i32>,
) -> Result<(String, String), sqlx::Error> {
    if let Some(rid) = release_id {
        let row: Option<(String, i64)> = sqlx::query_as(
            r#"SELECT "albumArtist", COUNT(*) as cnt
               FROM "LocalReleaseTrack"
               WHERE "localReleaseId" = $1
                 AND id != $2
                 AND "albumArtist" IS NOT NULL
                 AND "albumArtist" != ''
                 AND "albumArtist" !~ '^\d{1,3}$'
                 AND "albumArtist" !~ '^\d{1,3}\s*-\s*\S'
                 AND "albumArtist" !~ '@\d{2,3}$'
                 AND "albumArtist" NOT ILIKE '%lbumArtist/%'
                 AND ($3::int IS NULL OR "albumArtist" != $3::text)
               GROUP BY "albumArtist"
               ORDER BY cnt DESC
               LIMIT 1"#,
        )
        .bind(rid)
        .bind(track_id)
        .bind(year)
        .fetch_optional(pool)
        .await?;

        if let Some((val, cnt)) = row {
            let confidence = if cnt >= 3 { "high" } else { "medium" };
            return Ok((val, confidence.to_string()));
        }

        let row: Option<(Option<String>,)> = sqlx::query_as(
            r#"SELECT artist FROM "LocalReleaseTrack" WHERE id = $1"#,
        )
        .bind(track_id)
        .fetch_optional(pool)
        .await?;

        if let Some((Some(artist),)) = row {
            if !artist.is_empty() && !DIGIT_RE.is_match(&artist) {
                return Ok((artist, "low".to_string()));
            }
        }
    }

    Ok((String::new(), String::new()))
}
