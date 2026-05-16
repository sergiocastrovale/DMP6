use cuid2::create_id;
use sqlx::PgPool;

pub async fn detect(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    sqlx::query(r#"DELETE FROM "IssueDuplicateArtist""#)
        .execute(pool)
        .await?;

    let rows: Vec<(String, String, Option<String>, Option<String>, i64, i64)> =
        sqlx::query_as(
            r#"SELECT a1.id, a2.id,
                      a1."musicbrainzId", a2."musicbrainzId",
                      (SELECT COUNT(*) FROM "TrackArtist" WHERE "artistId" = a1.id),
                      (SELECT COUNT(*) FROM "TrackArtist" WHERE "artistId" = a2.id)
               FROM "Artist" a1
               JOIN "Artist" a2 ON a1.id < a2.id
               WHERE LOWER(REGEXP_REPLACE(a1.name, '[^a-zA-Z0-9\p{L}]', '', 'g')) =
                     LOWER(REGEXP_REPLACE(a2.name, '[^a-zA-Z0-9\p{L}]', '', 'g'))
                 AND REGEXP_REPLACE(a1.name, '[^a-zA-Z0-9\p{L}]', '', 'g') <> ''"#,
        )
        .fetch_all(pool)
        .await?;

    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    for (id1, id2, mb1, mb2, tracks1, tracks2) in &rows {
        if let (Some(m1), Some(m2)) = (mb1, mb2) {
            if m1 != m2 { continue; }
        }

        let (artist_a, artist_b) = if tracks1 >= tracks2 {
            (id1.as_str(), id2.as_str())
        } else {
            (id2.as_str(), id1.as_str())
        };

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
