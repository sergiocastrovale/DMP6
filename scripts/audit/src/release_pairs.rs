use common::release_pairs::{classify_release_pair, ReleasePairKind};
use cuid2::create_id;
use sqlx::PgPool;

// Both rules share the same "LocalReleases pointing at the same MusicBrainzRelease" self-join;
// they diverge only in which classify_release_pair() bucket they keep.
type CandidateRow = (
    String,
    String,
    String,
    String,
    Option<i32>,
    Option<i32>,
    i64,
    i64,
);

async fn candidate_pairs(
    executor: impl sqlx::PgExecutor<'_>,
) -> Result<Vec<CandidateRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT lr1.id, lr2.id, lr1.title, lr2.title,
                  lr1."totalDuration", lr2."totalDuration",
                  (SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "localReleaseId" = lr1.id),
                  (SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "localReleaseId" = lr2.id)
           FROM "LocalRelease" lr1
           JOIN "LocalRelease" lr2 ON lr1."releaseId" = lr2."releaseId" AND lr1.id < lr2.id
           WHERE lr1."releaseId" IS NOT NULL"#,
    )
    .fetch_all(executor)
    .await
}

/// One transaction for the whole pass: without it, a crash between the DELETE and the last INSERT
/// would leave the DETECTED set empty/partial until the next run re-derives it (PENDING/RESOLVED/
/// FAILED rows are untouched either way, so nothing is permanently lost) and a run that dies
/// partway would silently under-report instead of reporting none.
pub async fn detect_duplicate_release(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query(r#"DELETE FROM "IssueDuplicateRelease" WHERE status = 'DETECTED'"#)
        .execute(&mut *tx)
        .await?;

    let rows = candidate_pairs(&mut *tx).await?;
    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    // One read for every already-tracked pair instead of a round trip per candidate below.
    let already_tracked_pairs: std::collections::HashSet<(String, String)> = {
        let pairs: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT "releaseAId", "releaseBId" FROM "IssueDuplicateRelease"
               WHERE status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED')"#,
        )
        .fetch_all(&mut *tx)
        .await?;
        pairs
            .into_iter()
            .map(|(a, b)| if a < b { (a, b) } else { (b, a) })
            .collect()
    };

    for (id1, id2, title1, title2, dur1, dur2, tracks1, tracks2) in &rows {
        let kind = classify_release_pair(
            title1,
            title2,
            dur1.map(i64::from),
            dur2.map(i64::from),
            *tracks1,
            *tracks2,
        );
        if kind != ReleasePairKind::DuplicateRelease {
            continue;
        }

        let tracked_key = if id1 < id2 {
            (id1.clone(), id2.clone())
        } else {
            (id2.clone(), id1.clone())
        };
        if already_tracked_pairs.contains(&tracked_key) {
            continue;
        }

        let id = create_id();
        sqlx::query(
            r#"INSERT INTO "IssueDuplicateRelease"
               (id, "auditRunId", status, "releaseAId", "releaseBId", "createdAt", "updatedAt")
               VALUES ($1, $2, 'DETECTED', $3, $4, $5, $5)"#,
        )
        .bind(&id)
        .bind(run_id)
        .bind(id1)
        .bind(id2)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        inserted += 1;
    }

    Ok(inserted)
}

/// See detect_duplicate_release's doc comment - same one-transaction rationale.
pub async fn detect_mismatched_release_id(
    pool: &PgPool,
    run_id: &str,
) -> Result<usize, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query(r#"DELETE FROM "IssueMismatchedReleaseId" WHERE status = 'DETECTED'"#)
        .execute(&mut *tx)
        .await?;

    let rows = candidate_pairs(&mut *tx).await?;
    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

    // One read for every already-tracked pair instead of a round trip per candidate below.
    let already_tracked_pairs: std::collections::HashSet<(String, String)> = {
        let pairs: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT "releaseAId", "releaseBId" FROM "IssueMismatchedReleaseId"
               WHERE status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED')"#,
        )
        .fetch_all(&mut *tx)
        .await?;
        pairs
            .into_iter()
            .map(|(a, b)| if a < b { (a, b) } else { (b, a) })
            .collect()
    };

    for (id1, id2, title1, title2, dur1, dur2, tracks1, tracks2) in &rows {
        let kind = classify_release_pair(
            title1,
            title2,
            dur1.map(i64::from),
            dur2.map(i64::from),
            *tracks1,
            *tracks2,
        );
        if kind != ReleasePairKind::MismatchedReleaseId {
            continue;
        }

        let tracked_key = if id1 < id2 {
            (id1.clone(), id2.clone())
        } else {
            (id2.clone(), id1.clone())
        };
        if already_tracked_pairs.contains(&tracked_key) {
            continue;
        }

        let id = create_id();
        sqlx::query(
            r#"INSERT INTO "IssueMismatchedReleaseId"
               (id, "auditRunId", status, "releaseAId", "releaseBId", "createdAt", "updatedAt")
               VALUES ($1, $2, 'DETECTED', $3, $4, $5, $5)"#,
        )
        .bind(&id)
        .bind(run_id)
        .bind(id1)
        .bind(id2)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        inserted += 1;
    }

    tx.commit().await?;
    Ok(inserted)
}
