//! `update_artist_totals_for_artist` against a real Postgres (`#[ignore]`d; `scripts/test-db` runs it).
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p common --test totals -- --ignored

use common::totals::update_artist_totals_for_artist;
use sqlx::PgPool;

const SCOPE: &str = "totals-fixture";

async fn pool() -> PgPool {
    let url = std::env::var("SMOKE_TEST_DATABASE_URL")
        .expect("set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres");
    PgPool::connect(&url).await.expect("connect")
}

async fn reset(pool: &PgPool) {
    sqlx::query(r#"DELETE FROM "LocalRelease" WHERE "groupKey" LIKE $1"#)
        .bind(format!("folder:{SCOPE}/%"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(r#"DELETE FROM "Artist" WHERE slug = $1"#)
        .bind(SCOPE)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn tracks_with_the_same_file_size_are_each_counted() {
    let pool = pool().await;
    reset(&pool).await;

    let artist_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "Artist" (id, name, slug, "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $2, 0, 0, now(), now())"#,
    )
    .bind(&artist_id)
    .bind(SCOPE)
    .execute(&pool)
    .await
    .unwrap();

    let release_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
           VALUES ($1, 'Fixture', 2020, $2, $3, now(), now())"#,
    )
    .bind(&release_id)
    .bind(format!("folder:{SCOPE}/a"))
    .bind(format!("{SCOPE}/a"))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
           VALUES ($1, $2, $3, now())"#,
    )
    .bind(cuid2::create_id())
    .bind(&release_id)
    .bind(&artist_id)
    .execute(&pool)
    .await
    .unwrap();

    // Three distinct tracks that happen to share the same byte size - a real coincidence for
    // same-length silences/intros, and a certainty once the library is large enough.
    for n in 0..3 {
        sqlx::query(
            r#"INSERT INTO "LocalReleaseTrack" (id, "localReleaseId", "filePath", "fileSize", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, 1000, now(), now())"#,
        )
        .bind(cuid2::create_id())
        .bind(&release_id)
        .bind(format!("{SCOPE}/a/{n}.flac"))
        .execute(&pool)
        .await
        .unwrap();
    }

    update_artist_totals_for_artist(&pool, &artist_id)
        .await
        .unwrap();

    let (tracks, size): (i32, i64) =
        sqlx::query_as(r#"SELECT "totalTracks", "totalFileSize" FROM "Artist" WHERE id = $1"#)
            .bind(&artist_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(tracks, 3);
    assert_eq!(
        size, 3000,
        "each same-sized track must count toward the total, not collapse to one"
    );

    reset(&pool).await;
}
