use cuid2::create_id;
use sqlx::PgPool;
use common::release_pairs::{classify_release_pair, ReleasePairKind};

// Both rules share the same "LocalReleases pointing at the same MusicBrainzRelease" self-join;
// they diverge only in which classify_release_pair() bucket they keep.
type CandidateRow = (String, String, String, String, Option<i32>, Option<i32>, i64, i64);

async fn candidate_pairs(pool: &PgPool) -> Result<Vec<CandidateRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT lr1.id, lr2.id, lr1.title, lr2.title,
                  lr1."totalDuration", lr2."totalDuration",
                  (SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "localReleaseId" = lr1.id),
                  (SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "localReleaseId" = lr2.id)
           FROM "LocalRelease" lr1
           JOIN "LocalRelease" lr2 ON lr1."releaseId" = lr2."releaseId" AND lr1.id < lr2.id
           WHERE lr1."releaseId" IS NOT NULL"#,
    )
    .fetch_all(pool)
    .await
}

pub async fn detect_duplicate_release(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    sqlx::query(r#"DELETE FROM "IssueDuplicateRelease" WHERE status = 'DETECTED'"#)
        .execute(pool)
        .await?;

    let rows = candidate_pairs(pool).await?;
    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

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

        let already_tracked: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM "IssueDuplicateRelease"
               WHERE (("releaseAId" = $1 AND "releaseBId" = $2) OR ("releaseAId" = $2 AND "releaseBId" = $1))
                 AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED'))"#,
        )
        .bind(id1)
        .bind(id2)
        .fetch_one(pool)
        .await?;
        if already_tracked {
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
        .execute(pool)
        .await?;

        inserted += 1;
    }

    Ok(inserted)
}

pub async fn detect_mismatched_release_id(pool: &PgPool, run_id: &str) -> Result<usize, sqlx::Error> {
    sqlx::query(r#"DELETE FROM "IssueMismatchedReleaseId" WHERE status = 'DETECTED'"#)
        .execute(pool)
        .await?;

    let rows = candidate_pairs(pool).await?;
    let mut inserted = 0usize;
    let now = chrono::Utc::now().naive_utc();

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

        let already_tracked: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM "IssueMismatchedReleaseId"
               WHERE (("releaseAId" = $1 AND "releaseBId" = $2) OR ("releaseAId" = $2 AND "releaseBId" = $1))
                 AND status IN ('PENDING', 'PENDING_REVERT', 'RESOLVED'))"#,
        )
        .bind(id1)
        .bind(id2)
        .fetch_one(pool)
        .await?;
        if already_tracked {
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
        .execute(pool)
        .await?;

        inserted += 1;
    }

    Ok(inserted)
}
