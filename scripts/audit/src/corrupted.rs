use cuid2::create_id;
use sqlx::PgPool;
use std::sync::LazyLock;

static DIGIT_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^\d{1,3}$").unwrap());

/// One transaction for the whole detect pass: without it, a crash between the DELETE and the last
/// INSERT would leave the DETECTED set empty (or partial) until the next run re-derives it - never
/// permanent data loss (PENDING/RESOLVED/FAILED rows are untouched), but a run that dies partway
/// would silently under-report issues instead of reporting none.
pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueCorruptedTpe2" WHERE status = 'DETECTED'"#)
        .execute(&mut *tx)
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
             AND "albumArtist" != ''
             AND "albumArtist" <> ALL($1::text[])"#,
    )
    .bind(common::artists::KNOWN_NUMERIC_ARTIST_NAMES)
    .fetch_all(&mut *tx)
    .await?;

    if rows.is_empty() {
        tx.commit().await?;
        return Ok(0);
    }

    let mut inserted = 0usize;

    // One read for every already-tracked track instead of a round trip per candidate below.
    let candidate_ids: Vec<&str> = rows.iter().map(|(id, ..)| id.as_str()).collect();
    let already_tracked_ids: std::collections::HashSet<String> = sqlx::query_scalar(
        r#"SELECT "trackId" FROM "IssueCorruptedTpe2"
           WHERE "trackId" = ANY($1::text[]) AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED')"#,
    )
    .bind(&candidate_ids)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();

    for (track_id, current_value, release_id, year) in &rows {
        if already_tracked_ids.contains(track_id) {
            continue;
        }

        let (proposed_value, confidence) =
            find_proposed(&mut tx, track_id, release_id.as_deref(), *year).await?;

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
        .execute(&mut *tx)
        .await?;

        inserted += 1;
    }

    tx.commit().await?;
    Ok(inserted)
}

async fn find_proposed(
    tx: &mut sqlx::PgConnection,
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
        .fetch_optional(&mut *tx)
        .await?;

        if let Some((val, cnt)) = row {
            let confidence = if cnt >= 3 { "high" } else { "medium" };
            return Ok((val, confidence.to_string()));
        }

        let row: Option<(Option<String>,)> =
            sqlx::query_as(r#"SELECT artist FROM "LocalReleaseTrack" WHERE id = $1"#)
                .bind(track_id)
                .fetch_optional(&mut *tx)
                .await?;

        if let Some((Some(artist),)) = row {
            if !artist.is_empty() && !DIGIT_RE.is_match(&artist) {
                return Ok((artist, "low".to_string()));
            }
        }
    }

    Ok((String::new(), String::new()))
}
