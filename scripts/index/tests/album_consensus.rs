//! Regression test for the no-guessing release-placement gate (docs/no_guessing.md).
//!
//! `apply_folder_consensus` re-evaluates a folder's tracks straight from the DB after every index
//! run and either parks a disagreeing release at UNKNOWN with a reason, or clears a previously
//! flagged one back to UNMATCHED once it has been retagged into agreement. Box-placed / member
//! releases must be left alone - their placement comes from the box pass, not from tags.
//!
//! Integration test against a REAL Postgres, so it is `#[ignore]`d and never runs on a plain
//! `cargo test`. Point it at a disposable, migrated database - never the production `DATABASE_URL`,
//! it writes and deletes rows:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p index --release --test album_consensus \
//!     -- --ignored --nocapture

use index::db::apply_folder_consensus;
use sqlx::PgPool;

const FIXTURE_PREFIX: &str = "album-consensus-fixture";

struct Release {
    id: String,
}

async fn insert_release(
    pool: &PgPool,
    slug: &str,
    status: &str,
    status_reason: Option<&str>,
    release_id_fk: Option<&str>,
    box_release_id: Option<&str>,
    medium_position: Option<i32>,
) -> Release {
    let id = cuid2::create_id();
    let group_key = format!("folder:{}/{}", FIXTURE_PREFIX, slug);
    let folder_path = format!("{}/{}", FIXTURE_PREFIX, slug);
    sqlx::query(
        r#"INSERT INTO "LocalRelease"
             (id, title, year, "groupKey", "folderPath", "matchStatus", "statusReason",
              "releaseId", "boxReleaseId", "mediumPosition", "createdAt", "updatedAt")
           VALUES ($1, $2, 2020, $3, $4, $5::"ReleaseStatus", $6, $7, $8, $9, now(), now())"#,
    )
    .bind(&id)
    .bind(slug)
    .bind(&group_key)
    .bind(&folder_path)
    .bind(status)
    .bind(status_reason)
    .bind(release_id_fk)
    .bind(box_release_id)
    .bind(medium_position)
    .execute(pool)
    .await
    .expect("insert fixture LocalRelease");
    Release { id }
}

async fn insert_track(
    pool: &PgPool,
    release_id: &str,
    slug: &str,
    n: i32,
    album: Option<&str>,
    mb_track_id: Option<&str>,
) -> String {
    let id = cuid2::create_id();
    let file_path = format!("{}/{}/track-{:02}.mp3", FIXTURE_PREFIX, slug, n);
    sqlx::query(
        r#"INSERT INTO "LocalReleaseTrack"
             (id, title, artist, "albumArtist", album, "trackNumber", "filePath", "localReleaseId",
              "mbTrackId", "createdAt", "updatedAt")
           VALUES ($1, $2, 'Consensus Fixture', 'Consensus Fixture', $3, $4, $5, $6, $7, now(), now())"#,
    )
    .bind(&id)
    .bind(format!("Track {:02}", n))
    .bind(album)
    .bind(n)
    .bind(&file_path)
    .bind(release_id)
    .bind(mb_track_id)
    .execute(pool)
    .await
    .expect("insert fixture LocalReleaseTrack");
    id
}

async fn insert_mb_release_track(pool: &PgPool) -> (String, String) {
    let type_id: String = sqlx::query_scalar(
        r#"INSERT INTO "ReleaseType" (id, name, slug, "createdAt", "updatedAt")
           VALUES ('release-type-album', 'Album', 'album', now(), now())
           ON CONFLICT (name) DO UPDATE SET "updatedAt" = now()
           RETURNING id"#,
    )
    .fetch_one(pool)
    .await
    .expect("ensure fixture ReleaseType");

    let mb_release_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "MusicBrainzRelease"
             (id, title, "typeId", "musicbrainzId", status, "createdAt", "updatedAt")
           VALUES ($1, 'Consensus Fixture MB Release', $3, $2, 'COMPLETE'::"ReleaseStatus", now(), now())"#,
    )
    .bind(&mb_release_id)
    .bind(cuid2::create_id())
    .bind(&type_id)
    .execute(pool)
    .await
    .expect("insert fixture MusicBrainzRelease");

    let mb_track_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "MusicBrainzReleaseTrack" (id, title, "releaseId", "createdAt", "updatedAt")
           VALUES ($1, 'Consensus Fixture MB Track', $2, now(), now())"#,
    )
    .bind(&mb_track_id)
    .bind(&mb_release_id)
    .execute(pool)
    .await
    .expect("insert fixture MusicBrainzReleaseTrack");

    (mb_release_id, mb_track_id)
}

async fn release_row(pool: &PgPool, id: &str) -> (String, Option<String>, String) {
    sqlx::query_as::<_, (String, Option<String>, String)>(
        r#"SELECT "matchStatus"::text, "statusReason", title FROM "LocalRelease" WHERE id = $1"#,
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .expect("read fixture LocalRelease")
}

async fn track_mb_id(pool: &PgPool, id: &str) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>(
        r#"SELECT "mbTrackId" FROM "LocalReleaseTrack" WHERE id = $1"#,
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .expect("read fixture LocalReleaseTrack")
}

async fn reset_fixture(pool: &PgPool) {
    sqlx::query(r#"DELETE FROM "LocalReleaseTrack" WHERE "filePath" LIKE $1"#)
        .bind(format!("{}%", FIXTURE_PREFIX))
        .execute(pool)
        .await
        .expect("clear fixture tracks");
    sqlx::query(r#"DELETE FROM "LocalRelease" WHERE "groupKey" LIKE $1"#)
        .bind(format!("folder:{}%", FIXTURE_PREFIX))
        .execute(pool)
        .await
        .expect("clear fixture releases");
    sqlx::query(r#"DELETE FROM "MusicBrainzRelease" WHERE title = 'Consensus Fixture MB Release'"#)
        .execute(pool)
        .await
        .expect("clear fixture MB releases");
}

#[tokio::test]
#[ignore]
async fn bound_disagreeing_release_is_unbound_with_reason_and_leaf_title() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
        "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
         against the production DATABASE_URL",
    );
    let pool = common::db::create_pool(&db_url, "test")
        .await
        .expect("connect");
    reset_fixture(&pool).await;

    let (mb_release_id, mb_track_id) = insert_mb_release_track(&pool).await;
    let release = insert_release(
        &pool,
        "scattered",
        "COMPLETE",
        None,
        Some(&mb_release_id),
        None,
        None,
    )
    .await;
    let t1 = insert_track(
        &pool,
        &release.id,
        "scattered",
        1,
        Some("Real Album"),
        Some(&mb_track_id),
    )
    .await;
    insert_track(
        &pool,
        &release.id,
        "scattered",
        2,
        Some("A Totally Different Album"),
        None,
    )
    .await;

    apply_folder_consensus(&pool, &[release.id.clone()])
        .await
        .expect("apply_folder_consensus");

    let (status, reason, title) = release_row(&pool, &release.id).await;
    assert_eq!(status, "UNKNOWN");
    assert_eq!(
        reason.as_deref(),
        Some("Tracks in the release folder disagree in 'album' metadata field")
    );
    assert_eq!(
        title, "scattered",
        "title must fall back to the folder leaf name"
    );
    assert_eq!(
        track_mb_id(&pool, &t1).await,
        None,
        "mbTrackId links must be cleared"
    );

    reset_fixture(&pool).await;
}

#[tokio::test]
#[ignore]
async fn box_placed_and_member_releases_are_untouched() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
        "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
         against the production DATABASE_URL",
    );
    let pool = common::db::create_pool(&db_url, "test")
        .await
        .expect("connect");
    reset_fixture(&pool).await;

    let (mb_release_id, _mb_track_id) = insert_mb_release_track(&pool).await;

    // Dissolved box disc: boxReleaseId set.
    let box_disc = insert_release(
        &pool,
        "box-disc",
        "COMPLETE",
        None,
        Some(&mb_release_id),
        Some(&mb_release_id),
        None,
    )
    .await;
    insert_track(&pool, &box_disc.id, "box-disc", 1, Some("Disc One"), None).await;
    insert_track(&pool, &box_disc.id, "box-disc", 2, Some("Disc Two"), None).await;

    // Folded multi-disc release: mediumPosition set.
    let folded = insert_release(
        &pool,
        "folded",
        "COMPLETE",
        None,
        Some(&mb_release_id),
        None,
        Some(1),
    )
    .await;
    insert_track(&pool, &folded.id, "folded", 1, Some("Side A"), None).await;
    insert_track(&pool, &folded.id, "folded", 2, Some("Side B"), None).await;

    let touched = vec![box_disc.id.clone(), folded.id.clone()];
    let stats = apply_folder_consensus(&pool, &touched)
        .await
        .expect("apply_folder_consensus");
    assert!(
        stats.reason_counts.is_empty(),
        "exempt releases must not be flagged"
    );

    let (box_status, box_reason, _) = release_row(&pool, &box_disc.id).await;
    assert_eq!(box_status, "COMPLETE");
    assert_eq!(box_reason, None);

    let (folded_status, folded_reason, _) = release_row(&pool, &folded.id).await;
    assert_eq!(folded_status, "COMPLETE");
    assert_eq!(folded_reason, None);

    reset_fixture(&pool).await;
}

#[tokio::test]
#[ignore]
async fn retagged_folder_returns_to_unmatched_with_reason_cleared_and_is_stable() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
        "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
         against the production DATABASE_URL",
    );
    let pool = common::db::create_pool(&db_url, "test")
        .await
        .expect("connect");
    reset_fixture(&pool).await;

    let release = insert_release(
        &pool,
        "retagged",
        "UNKNOWN",
        Some("Tracks in the release folder disagree in 'album' metadata field"),
        None,
        None,
        None,
    )
    .await;
    insert_track(&pool, &release.id, "retagged", 1, Some("Fixed Album"), None).await;
    insert_track(&pool, &release.id, "retagged", 2, Some("Fixed Album"), None).await;

    apply_folder_consensus(&pool, &[release.id.clone()])
        .await
        .expect("apply_folder_consensus");

    let (status, reason, title) = release_row(&pool, &release.id).await;
    assert_eq!(status, "UNMATCHED");
    assert_eq!(reason, None);
    assert_eq!(title, "Fixed Album");

    // Running again is a no-op: still UNMATCHED, still no reason, nothing to clear a second time.
    let stats = apply_folder_consensus(&pool, &[release.id.clone()])
        .await
        .expect("apply_folder_consensus");
    assert_eq!(stats.cleared, 0, "second run has nothing left to clear");
    assert!(stats.reason_counts.is_empty());

    let (status, reason, _) = release_row(&pool, &release.id).await;
    assert_eq!(status, "UNMATCHED");
    assert_eq!(reason, None);

    reset_fixture(&pool).await;
}
