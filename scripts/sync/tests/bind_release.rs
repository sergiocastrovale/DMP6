//! `bind_local_release` against a real Postgres (`#[ignore]`d; `scripts/test-db` runs it).
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p sync --test bind_release -- --ignored

use dmp_sync::db::bind_local_release;
use sqlx::PgPool;

const SCOPE: &str = "bind-release-fixture";

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
    sqlx::query(r#"DELETE FROM "MusicBrainzRelease" WHERE "musicbrainzId" LIKE $1"#)
        .bind(format!("{SCOPE}-%"))
        .execute(pool)
        .await
        .unwrap();
}

async fn mb_release(pool: &PgPool, suffix: &str, tracks: usize) -> (String, Vec<String>) {
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
           VALUES ($1, 'Fixture', $2, $3, $3, 'UNKNOWN', 1, '{}', now(), now())"#,
    )
    .bind(&id)
    .bind(&type_id)
    .bind(format!("{SCOPE}-{suffix}"))
    .execute(pool)
    .await
    .unwrap();
    let mut track_ids = Vec::new();
    for n in 0..tracks {
        let tid = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "MusicBrainzReleaseTrack" (id, title, "releaseId", position, "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, now(), now())"#,
        )
        .bind(&tid)
        .bind(format!("Track {n}"))
        .bind(&id)
        .bind(n as i32 + 1)
        .execute(pool)
        .await
        .unwrap();
        track_ids.push(tid);
    }
    (id, track_ids)
}

async fn local_release(pool: &PgPool, tracks: usize) -> (String, Vec<String>) {
    let id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
           VALUES ($1, 'Fixture', 2020, $2, $3, now(), now())"#,
    )
    .bind(&id)
    .bind(format!("folder:{SCOPE}/a"))
    .bind(format!("{SCOPE}/a"))
    .execute(pool)
    .await
    .unwrap();
    let mut track_ids = Vec::new();
    for n in 0..tracks {
        let tid = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalReleaseTrack" (id, "localReleaseId", "filePath", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, now(), now())"#,
        )
        .bind(&tid)
        .bind(&id)
        .bind(format!("{SCOPE}/a/{n}.flac"))
        .execute(pool)
        .await
        .unwrap();
        track_ids.push(tid);
    }
    (id, track_ids)
}

#[tokio::test]
#[ignore]
async fn rebinding_replaces_every_track_link_and_the_status() {
    let pool = pool().await;
    reset(&pool).await;
    let (old_mb, old_tracks) = mb_release(&pool, "old", 2).await;
    let (new_mb, new_tracks) = mb_release(&pool, "new", 2).await;
    let (local, local_tracks) = local_release(&pool, 2).await;

    let old_links: Vec<(String, String)> = local_tracks
        .iter()
        .cloned()
        .zip(old_tracks.iter().cloned())
        .collect();
    bind_local_release(&pool, &local, &old_mb, "COMPLETE", &old_links)
        .await
        .unwrap();

    let new_links = vec![(local_tracks[0].clone(), new_tracks[0].clone())];
    bind_local_release(&pool, &local, &new_mb, "INCOMPLETE", &new_links)
        .await
        .unwrap();

    let (release_id, status): (Option<String>, String) = sqlx::query_as(
        r#"SELECT "releaseId", "matchStatus"::text FROM "LocalRelease" WHERE id = $1"#,
    )
    .bind(&local)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(release_id.as_deref(), Some(new_mb.as_str()));
    assert_eq!(status, "INCOMPLETE");

    let links: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT id, "mbTrackId" FROM "LocalReleaseTrack" WHERE "localReleaseId" = $1"#,
    )
    .bind(&local)
    .fetch_all(&pool)
    .await
    .unwrap();
    for (track, mb_track) in links {
        let expected = (track == local_tracks[0]).then(|| new_tracks[0].clone());
        assert_eq!(
            mb_track, expected,
            "track {track} must not keep a stale link"
        );
    }

    reset(&pool).await;
}
