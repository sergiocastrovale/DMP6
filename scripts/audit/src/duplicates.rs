use cuid2::create_id;
use sqlx::PgPool;
use std::collections::HashSet;

pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    // Only clear stale DETECTED rows - PENDING (queued), PENDING_REVERT, RESOLVED and FAILED
    // are user/fix state and must survive across runs (queue, history trail, FixHistory links).
    sqlx::query(r#"DELETE FROM "IssueDuplicateArtist" WHERE status = 'DETECTED'"#)
        .execute(pool)
        .await?;

    let rows: Vec<(String, String, Option<String>, Option<String>, i64, i64)> = sqlx::query_as(
        r#"SELECT a1.id, a2.id,
                      a1."musicbrainzId", a2."musicbrainzId",
                      (SELECT COUNT(*) FROM "TrackRelatedArtist" WHERE "artistId" = a1.id),
                      (SELECT COUNT(*) FROM "TrackRelatedArtist" WHERE "artistId" = a2.id)
               FROM "Artist" a1
               JOIN "Artist" a2 ON a1.id < a2.id
               WHERE LOWER(REGEXP_REPLACE(a1.name, '[^[:alnum:]]', '', 'g')) =
                     LOWER(REGEXP_REPLACE(a2.name, '[^[:alnum:]]', '', 'g'))
                 AND REGEXP_REPLACE(a1.name, '[^[:alnum:]]', '', 'g') <> ''"#,
    )
    .fetch_all(pool)
    .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    let linked_pairs: HashSet<(String, String)> = {
        let rows: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT id, "primaryArtistId" FROM "Artist" WHERE "primaryArtistId" IS NOT NULL"#,
        )
        .fetch_all(pool)
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

    for (id1, id2, mb1, mb2, tracks1, tracks2) in &rows {
        if let (Some(m1), Some(m2)) = (mb1, mb2) {
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

        let already_tracked: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM "IssueDuplicateArtist"
               WHERE (("artistAId" = $1 AND "artistBId" = $2) OR ("artistAId" = $2 AND "artistBId" = $1))
                 AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED'))"#,
        )
        .bind(artist_a)
        .bind(artist_b)
        .fetch_one(pool)
        .await?;
        if already_tracked {
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
        .execute(pool)
        .await?;

        inserted += 1;
    }

    Ok(inserted)
}
