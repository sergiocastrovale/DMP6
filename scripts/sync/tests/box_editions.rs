//! `run_link_box_editions` against a real Postgres (`#[ignore]`d; `scripts/test-db` runs it).
//! Runs library-wide, so only ever point it at a disposable database.
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p sync --test box_editions -- --ignored

use dmp_sync::box_editions::run_link_box_editions;
use sqlx::PgPool;

const SCOPE: &str = "box-editions-fixture";
const TRACKS: [(&str, i32); 3] = [("First", 200_000), ("Second", 180_000), ("Third", 240_000)];

async fn pool() -> PgPool {
    let url = std::env::var("SMOKE_TEST_DATABASE_URL")
        .expect("set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres");
    PgPool::connect(&url).await.expect("connect")
}

async fn reset(pool: &PgPool) {
    sqlx::query(r#"DELETE FROM "MusicBrainzRelease" WHERE "musicbrainzId" LIKE $1"#)
        .bind(format!("{SCOPE}-%"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(r#"DELETE FROM "Artist" WHERE slug = $1"#)
        .bind(SCOPE)
        .execute(pool)
        .await
        .unwrap();
}

async fn artist(pool: &PgPool) -> String {
    let id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "Artist" (id, name, slug, "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $2, 0, 0, now(), now())"#,
    )
    .bind(&id)
    .bind(SCOPE)
    .execute(pool)
    .await
    .unwrap();
    id
}

/// A release with `media` identical discs of `TRACKS`, no recording ids (so only tiers 2/3 apply).
async fn release(pool: &PgPool, artist_id: &str, suffix: &str, media: i32) -> String {
    let type_id: String = sqlx::query_scalar(
        r#"INSERT INTO "ReleaseType" (id, name, slug, "createdAt", "updatedAt")
           VALUES ('release-type-album', 'Album', 'album', now(), now())
           ON CONFLICT (name) DO UPDATE SET "updatedAt" = now()
           RETURNING id"#,
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "MusicBrainzRelease"
             (id, title, "typeId", "musicbrainzId", "releaseGroupId", status, "mediumCount",
              "releaseGroupSecondaryTypes", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $2, $2, 'UNKNOWN', $4, '{}', now(), now())"#,
    )
    .bind(&id)
    .bind(format!("{SCOPE}-{suffix}"))
    .bind(&type_id)
    .bind(media)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "MusicBrainzReleaseArtist" (id, "releaseId", "artistId", "createdAt")
           VALUES ($1, $2, $3, now())"#,
    )
    .bind(cuid2::create_id())
    .bind(&id)
    .bind(artist_id)
    .execute(pool)
    .await
    .unwrap();
    for disc in 1..=media {
        sqlx::query(
            r#"INSERT INTO "MusicBrainzReleaseMedium" (id, "releaseId", position, "trackCount", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, now(), now())"#,
        )
        .bind(cuid2::create_id())
        .bind(&id)
        .bind(disc)
        .bind(TRACKS.len() as i32)
        .execute(pool)
        .await
        .unwrap();
        for (n, (title, ms)) in TRACKS.iter().enumerate() {
            sqlx::query(
                r#"INSERT INTO "MusicBrainzReleaseTrack"
                     (id, title, "releaseId", position, "discNumber", "durationMs", "createdAt", "updatedAt")
                   VALUES ($1, $2, $3, $4, $5, $6, now(), now())"#,
            )
            .bind(cuid2::create_id())
            .bind(title)
            .bind(&id)
            .bind(n as i32 + 1)
            .bind(disc)
            .bind(ms)
            .execute(pool)
            .await
            .unwrap();
        }
    }
    id
}

/// A release whose `media` discs all carry the same recording ids (tier 1's fingerprint input). Discs
/// are inserted highest position first, so a query leaning on physical row order would see the last
/// disc before the first.
async fn release_with_recordings(
    pool: &PgPool,
    artist_id: &str,
    suffix: &str,
    media: i32,
) -> String {
    let id = release(pool, artist_id, suffix, 0).await;
    sqlx::query(r#"UPDATE "MusicBrainzRelease" SET "mediumCount" = $2 WHERE id = $1"#)
        .bind(&id)
        .bind(media)
        .execute(pool)
        .await
        .unwrap();
    for disc in (1..=media).rev() {
        sqlx::query(
            r#"INSERT INTO "MusicBrainzReleaseMedium" (id, "releaseId", position, "trackCount", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, now(), now())"#,
        )
        .bind(cuid2::create_id())
        .bind(&id)
        .bind(disc)
        .bind(TRACKS.len() as i32)
        .execute(pool)
        .await
        .unwrap();
        for (n, (title, ms)) in TRACKS.iter().enumerate() {
            sqlx::query(
                r#"INSERT INTO "MusicBrainzReleaseTrack"
                     (id, title, "releaseId", position, "discNumber", "durationMs", "recordingId",
                      "createdAt", "updatedAt")
                   VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())"#,
            )
            .bind(cuid2::create_id())
            .bind(title)
            .bind(&id)
            .bind(n as i32 + 1)
            .bind(disc)
            .bind(ms)
            .bind(format!("{SCOPE}-recording-{n}"))
            .execute(pool)
            .await
            .unwrap();
        }
    }
    id
}

async fn equivalent_positions(
    pool: &PgPool,
    release_id: &str,
) -> Vec<(Option<String>, Option<i32>)> {
    sqlx::query_as(
        r#"SELECT "equivalentReleaseId", "equivalentMediumPosition" FROM "MusicBrainzReleaseMedium"
           WHERE "releaseId" = $1 ORDER BY position"#,
    )
    .bind(release_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn equivalents(pool: &PgPool, release_id: &str) -> Vec<Option<String>> {
    sqlx::query_scalar(
        r#"SELECT "equivalentReleaseId" FROM "MusicBrainzReleaseMedium"
           WHERE "releaseId" = $1 ORDER BY position"#,
    )
    .bind(release_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore]
async fn only_box_media_get_an_equivalent_edition() {
    let pool = pool().await;
    reset(&pool).await;
    let artist_id = artist(&pool).await;
    let album = release(&pool, &artist_id, "album", 1).await;
    let box_set = release(&pool, &artist_id, "box", 2).await;

    run_link_box_editions(&pool, &common::progress::Reporter::new(false))
        .await
        .unwrap();

    assert_eq!(equivalents(&pool, &album).await, vec![None]);
    assert_eq!(
        equivalents(&pool, &box_set).await,
        vec![Some(album.clone()), Some(album.clone())]
    );

    reset(&pool).await;
}

#[tokio::test]
#[ignore]
async fn a_release_carrying_the_same_album_twice_resolves_to_its_first_copy() {
    let pool = pool().await;
    reset(&pool).await;
    let artist_id = artist(&pool).await;
    let box_set = release_with_recordings(&pool, &artist_id, "a-box", 2).await;
    // Two discs of one release with an identical recording set: the release id alone can't choose
    // between them, so the lowest position has to.
    let deluxe = release_with_recordings(&pool, &artist_id, "b-deluxe", 2).await;

    run_link_box_editions(&pool, &common::progress::Reporter::new(false))
        .await
        .unwrap();

    assert_eq!(
        equivalent_positions(&pool, &box_set).await,
        vec![
            (Some(deluxe.clone()), Some(1)),
            (Some(deluxe.clone()), Some(1))
        ]
    );

    reset(&pool).await;
}
