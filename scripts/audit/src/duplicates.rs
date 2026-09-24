use cuid2::create_id;
use sqlx::PgPool;
use std::collections::HashSet;

/// One transaction for the whole pass - a crash between the DELETE and the last INSERT used to
/// leave the DETECTED set empty/partial until the next run re-derives it (PENDING/RESOLVED/FAILED
/// rows are untouched either way, so nothing is permanently lost, but a run that dies partway used to
/// silently under-report instead of reporting none).
pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueDuplicateArtist" WHERE status = 'DETECTED'"#)
        .execute(&mut *tx)
        .await?;

    #[derive(sqlx::FromRow)]
    struct DuplicateCandidateRow {
        id1: String,
        id2: String,
        mb1: Option<String>,
        mb2: Option<String>,
        tracks1: i64,
        tracks2: i64,
    }

    let rows: Vec<DuplicateCandidateRow> = sqlx::query_as(
        r#"SELECT a1.id AS id1, a2.id AS id2,
                      a1."musicbrainzId" AS mb1, a2."musicbrainzId" AS mb2,
                      (SELECT COUNT(*) FROM "TrackRelatedArtist" WHERE "artistId" = a1.id) AS tracks1,
                      (SELECT COUNT(*) FROM "TrackRelatedArtist" WHERE "artistId" = a2.id) AS tracks2
               FROM "Artist" a1
               JOIN "Artist" a2 ON a1.id < a2.id
               WHERE LOWER(REGEXP_REPLACE(a1.name, '[^[:alnum:]]', '', 'g')) =
                     LOWER(REGEXP_REPLACE(a2.name, '[^[:alnum:]]', '', 'g'))
                 AND REGEXP_REPLACE(a1.name, '[^[:alnum:]]', '', 'g') <> ''"#,
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    let linked_pairs: HashSet<(String, String)> = {
        let rows: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT id, "primaryArtistId" FROM "Artist" WHERE "primaryArtistId" IS NOT NULL"#,
        )
        .fetch_all(&mut *tx)
        .await?;
        rows.into_iter()
            .map(|(child, parent)| {
                if child < parent {
                    (child, parent)
                } else {
                    (parent, child)
                }
            })
            .collect()
    };

    // One read for every already-tracked pair instead of a round trip per candidate below - same
    // hoist as `linked_pairs` just above.
    let already_tracked_pairs: HashSet<(String, String)> = {
        let rows: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT "artistAId", "artistBId" FROM "IssueDuplicateArtist"
               WHERE status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED')"#,
        )
        .fetch_all(&mut *tx)
        .await?;
        rows.into_iter()
            .map(|(a, b)| if a < b { (a, b) } else { (b, a) })
            .collect()
    };

    for row in &rows {
        let (id1, id2, tracks1, tracks2) = (&row.id1, &row.id2, row.tracks1, row.tracks2);
        if let (Some(m1), Some(m2)) = (&row.mb1, &row.mb2) {
            if m1 != m2 {
                continue;
            }
        }

        let pair_key = if id1 < id2 {
            (id1.clone(), id2.clone())
        } else {
            (id2.clone(), id1.clone())
        };
        if linked_pairs.contains(&pair_key) {
            continue;
        }

        let (artist_a, artist_b) = if tracks1 >= tracks2 {
            (id1.as_str(), id2.as_str())
        } else {
            (id2.as_str(), id1.as_str())
        };

        let tracked_key = if artist_a < artist_b {
            (artist_a.to_string(), artist_b.to_string())
        } else {
            (artist_b.to_string(), artist_a.to_string())
        };
        if already_tracked_pairs.contains(&tracked_key) {
            continue;
        }

        let id = create_id();
        sqlx::query(
            r#"INSERT INTO "IssueDuplicateArtist"
               (id, "auditRunId", status, "artistAId", "artistBId", "createdAt", "updatedAt")
               VALUES ($1, $2, 'DETECTED', $3, $4, $5, $5)"#,
        )
        .bind(&id)
        .bind(run_id)
        .bind(artist_a)
        .bind(artist_b)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        inserted += 1;
    }

    tx.commit().await?;
    Ok(inserted)
}
