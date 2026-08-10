//! Regression test for the mount-blip ratio guard and `--prune`.
//!
//! `delete_removed_tracks` refuses to delete when more than 20% of the rows under a prefix are missing
//! from disk: that is the signature of an unmounted share, not of deleted music. But it is also the
//! exact signature of the ordinary case where an artist's folder is replaced wholesale - the old rip
//! removed, a fresh download dropped in - which left every stale row in the DB forever, showing up as
//! ghost tracks and duplicate releases. `--prune` (passed only for a folder the run just walked and
//! found audio files in, so the mount is provably up) bypasses the guard.
//!
//! Integration test against a REAL Postgres, so it is `#[ignore]`d and never runs on a plain
//! `cargo test`. Point it at a disposable, migrated database - never the production `DATABASE_URL`,
//! it writes and deletes rows:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p index --release --test prune_guard \
//!     -- --ignored --nocapture

use index::deletion::delete_removed_tracks;
use sqlx::PgPool;

const FOLDER: &str = "prune-guard-fixture";
const PREFIX: &str = "prune-guard-fixture/";
const PRESENT_FILE: &str = "prune-guard-fixture/album/present.mp3";

/// One file that really exists on disk, nine rows pointing at files that do not: 9/10 missing, far
/// past MAX_MISSING_RATIO.
async fn seed(pool: &PgPool, music_dir: &std::path::Path) -> (String, Vec<String>) {
    let release_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "matchStatus", "createdAt", "updatedAt")
           VALUES ($1, 'Prune Guard Fixture', 2020, $2, $3, 'COMPLETE'::"ReleaseStatus", now(), now())"#,
    )
    .bind(&release_id)
    .bind(format!("folder:{}/album", FOLDER))
    .bind(format!("{}/album", FOLDER))
    .execute(pool)
    .await
    .expect("insert fixture LocalRelease");

    std::fs::create_dir_all(music_dir.join(FOLDER).join("album")).expect("create fixture folder");
    std::fs::write(music_dir.join(PRESENT_FILE), b"not really audio").expect("write fixture file");

    let mut missing_ids: Vec<String> = Vec::new();
    for i in 0..10 {
        let id = cuid2::create_id();
        let file_path = if i == 0 {
            PRESENT_FILE.to_string()
        } else {
            format!("{}/album/gone-{:02}.mp3", FOLDER, i)
        };
        sqlx::query(
            r#"INSERT INTO "LocalReleaseTrack"
                 (id, title, artist, "albumArtist", album, "filePath", "localReleaseId", "playCount",
                  "createdAt", "updatedAt")
               VALUES ($1, $2, 'Prune Guard', 'Prune Guard', 'Prune Guard Fixture', $3, $4, 0, now(), now())"#,
        )
        .bind(&id)
        .bind(format!("Track {:02}", i))
        .bind(&file_path)
        .bind(&release_id)
        .execute(pool)
        .await
        .expect("insert fixture LocalReleaseTrack");
        if i > 0 {
            missing_ids.push(id);
        }
    }

    (release_id, missing_ids)
}

async fn track_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#,
    )
    .bind(format!("{}%", PREFIX))
    .fetch_one(pool)
    .await
    .expect("count fixture tracks")
}

async fn match_status(pool: &PgPool, release_id: &str) -> String {
    sqlx::query_scalar::<_, String>(
        r#"SELECT "matchStatus"::text FROM "LocalRelease" WHERE id = $1"#,
    )
    .bind(release_id)
    .fetch_one(pool)
    .await
    .expect("read fixture matchStatus")
}

async fn reset_fixture(pool: &PgPool, music_dir: &std::path::Path) {
    sqlx::query(r#"DELETE FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#)
        .bind(format!("{}%", PREFIX))
        .execute(pool)
        .await
        .expect("clear fixture tracks");
    sqlx::query(r#"DELETE FROM "LocalRelease" WHERE "groupKey" LIKE $1"#)
        .bind(format!("folder:{}%", FOLDER))
        .execute(pool)
        .await
        .expect("clear fixture releases");
    std::fs::remove_dir_all(music_dir.join(FOLDER)).ok();
}

#[tokio::test]
#[ignore]
async fn prune_bypasses_the_mount_blip_guard() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
        "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
         against the production DATABASE_URL",
    );
    let pool = common::db::create_pool(&db_url).await;
    let music_dir = std::env::temp_dir().join("dmp-prune-guard-music");
    std::fs::create_dir_all(&music_dir).expect("create fixture music dir");
    let music_dir_str = music_dir.to_string_lossy().to_string();

    reset_fixture(&pool, &music_dir).await;
    let (release_id, _missing) = seed(&pool, &music_dir).await;

    // Without --prune: 9/10 missing reads as a mount blip, nothing is touched.
    let guarded = delete_removed_tracks(&pool, PREFIX, &music_dir_str, false).await;
    assert_eq!(guarded.count, 0, "the ratio guard should have deleted nothing");
    assert_eq!(track_count(&pool).await, 10, "guarded run deleted rows anyway");
    assert_eq!(
        match_status(&pool, &release_id).await,
        "COMPLETE",
        "guarded run must not reset the release status either"
    );

    // With --prune: the missing rows go, the file that still exists stays, and the release is flagged
    // for sync to recompute.
    let pruned = delete_removed_tracks(&pool, PREFIX, &music_dir_str, true).await;
    assert_eq!(pruned.count, 9, "prune should delete every missing row");
    assert_eq!(track_count(&pool).await, 1, "prune deleted a file that exists on disk");
    assert_eq!(
        match_status(&pool, &release_id).await,
        "UNKNOWN",
        "a pruned release must be flagged for sync recalculation"
    );

    // A folder with nothing missing is unaffected either way.
    let noop = delete_removed_tracks(&pool, PREFIX, &music_dir_str, true).await;
    assert_eq!(noop.count, 0, "prune deleted rows whose files are present");

    reset_fixture(&pool, &music_dir).await;
}
