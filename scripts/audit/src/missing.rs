use cuid2::create_id;
use serde_json::{json, Map, Value};
use sqlx::PgPool;

/// One transaction for the whole pass: without it, a crash between the DELETE and the last INSERT
/// would leave the DETECTED set empty/partial until the next run re-derives it (PENDING/RESOLVED/
/// FAILED rows are untouched either way, so nothing is permanently lost) and a run that dies
/// partway would silently under-report instead of reporting none.
pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueMissingMetadata" WHERE status = 'DETECTED'"#)
        .execute(&mut *tx)
        .await?;

    #[derive(sqlx::FromRow)]
    struct MissingMetadataRow {
        id: String,
        title: Option<String>,
        artist: Option<String>,
        #[sqlx(rename = "albumArtist")]
        album_artist: Option<String>,
        album: Option<String>,
        year: Option<i32>,
        #[sqlx(rename = "localReleaseId")]
        release_id: Option<String>,
    }

    let rows: Vec<MissingMetadataRow> = sqlx::query_as(
        r#"SELECT id, title, artist, "albumArtist", album, year, "localReleaseId"
               FROM "LocalReleaseTrack"
               WHERE (title IS NULL OR title = '')
                  OR (artist IS NULL OR artist = '')
                  OR ("albumArtist" IS NULL OR "albumArtist" = '')
                  OR (album IS NULL OR album = '')
                  OR year IS NULL"#,
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    // One read for every already-tracked track instead of a round trip per candidate below.
    let candidate_ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    let already_tracked_ids: std::collections::HashSet<String> = sqlx::query_scalar(
        r#"SELECT "trackId" FROM "IssueMissingMetadata"
           WHERE "trackId" = ANY($1::text[]) AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED')"#,
    )
    .bind(&candidate_ids)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();

    for row in &rows {
        let track_id = &row.id;
        if already_tracked_ids.contains(track_id) {
            continue;
        }

        let mut missing_fields: Vec<&str> = Vec::new();
        if row.title.as_deref().is_none_or(|s| s.is_empty()) {
            missing_fields.push("title");
        }
        if row.artist.as_deref().is_none_or(|s| s.is_empty()) {
            missing_fields.push("artist");
        }
        if row.album_artist.as_deref().is_none_or(|s| s.is_empty()) {
            missing_fields.push("albumArtist");
        }
        if row.album.as_deref().is_none_or(|s| s.is_empty()) {
            missing_fields.push("album");
        }
        if row.year.is_none() {
            missing_fields.push("year");
        }

        let proposed = build_proposed(
            &mut tx,
            &missing_fields,
            &row.artist,
            &row.album_artist,
            &row.year,
            row.release_id.as_deref(),
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
        .execute(&mut *tx)
        .await?;

        inserted += 1;
    }

    tx.commit().await?;
    Ok(inserted)
}

async fn build_proposed(
    tx: &mut sqlx::PgConnection,
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
            .fetch_optional(&mut *tx)
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
