use cuid2::create_id;
use serde_json::{json, Map, Value};
use sqlx::PgPool;

pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueMissingMetadata" WHERE status = 'DETECTED'"#)
        .execute(pool)
        .await?;

    let rows: Vec<(
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i32>,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT id, title, artist, "albumArtist", album, year, "localReleaseId"
               FROM "LocalReleaseTrack"
               WHERE (title IS NULL OR title = '')
                  OR (artist IS NULL OR artist = '')
                  OR ("albumArtist" IS NULL OR "albumArtist" = '')
                  OR (album IS NULL OR album = '')
                  OR year IS NULL"#,
    )
    .fetch_all(pool)
    .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    for (track_id, title, artist, album_artist, album, year, release_id) in &rows {
        let mut missing_fields: Vec<&str> = Vec::new();
        if title.as_deref().map_or(true, |s| s.is_empty()) {
            missing_fields.push("title");
        }
        if artist.as_deref().map_or(true, |s| s.is_empty()) {
            missing_fields.push("artist");
        }
        if album_artist.as_deref().map_or(true, |s| s.is_empty()) {
            missing_fields.push("albumArtist");
        }
        if album.as_deref().map_or(true, |s| s.is_empty()) {
            missing_fields.push("album");
        }
        if year.is_none() {
            missing_fields.push("year");
        }

        let already_tracked: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM "IssueMissingMetadata"
               WHERE "trackId" = $1 AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED'))"#,
        )
        .bind(track_id)
        .fetch_one(pool)
        .await?;
        if already_tracked {
            continue;
        }

        let proposed = build_proposed(
            pool,
            &missing_fields,
            artist,
            album_artist,
            year,
            release_id.as_deref(),
        )
        .await?;

        let id = create_id();
        sqlx::query(
            r#"INSERT INTO "IssueMissingMetadata"
               (id, "auditRunId", status, "trackId", "missingFields", "proposedValues", "createdAt", "updatedAt")
               VALUES ($1, $2, 'DETECTED', $3, $4, $5, $6, $6)"#,
        )
        .bind(&id)
        .bind(run_id)
        .bind(track_id)
        .bind(&missing_fields)
        .bind(proposed)
        .bind(now)
        .execute(pool)
        .await?;

        inserted += 1;
    }

    Ok(inserted)
}

async fn build_proposed(
    pool: &PgPool,
    missing: &[&str],
    artist: &Option<String>,
    album_artist: &Option<String>,
    year: &Option<i32>,
    release_id: Option<&str>,
) -> Result<Option<Value>, sqlx::Error> {
    let mut props: Map<String, Value> = Map::new();

    if missing.contains(&"albumArtist") {
        if let Some(a) = artist.as_deref().filter(|s| !s.is_empty()) {
            props.insert("albumArtist".into(), json!(a));
        }
    }
    if missing.contains(&"artist") {
        if let Some(aa) = album_artist.as_deref().filter(|s| !s.is_empty()) {
            props.insert("artist".into(), json!(aa));
        }
    }
    if missing.contains(&"year") && year.is_none() {
        if let Some(rid) = release_id {
            let row: Option<(Option<i32>, i64)> = sqlx::query_as(
                r#"SELECT year, COUNT(*) as cnt
                   FROM "LocalReleaseTrack"
                   WHERE "localReleaseId" = $1 AND year IS NOT NULL
                   GROUP BY year ORDER BY cnt DESC LIMIT 1"#,
            )
            .bind(rid)
            .fetch_optional(pool)
            .await?;
            if let Some((Some(y), _)) = row {
                props.insert("year".into(), json!(y));
            }
        }
    }

    if props.is_empty() {
        Ok(None)
    } else {
        Ok(Some(Value::Object(props)))
    }
}
