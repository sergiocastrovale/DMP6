//! Regression test for the orphan-artist cleanup pass.
//!
//! A credit-only artist - MB-verified, credited on someone else's track, owning no release of their
//! own (Count Basie guesting on a Sinatra album) - is a legitimate row whose ONLY link is a
//! `TrackRelatedArtist` credit. The cleanup must therefore check all three link tables. Dropping the
//! credit table from that check deletes every credit artist the resolver just created and cascades
//! their credits away; that exact bug shipped once and silently emptied the feature for months.
//!
//! Like `sync`'s `catalogue_smoke.rs`, this is an integration test against a REAL Postgres, so it is
//! `#[ignore]`d and never runs on a plain `cargo test`. Point it at a disposable, migrated database -
//! never the production `DATABASE_URL`, it writes and deletes rows:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p index --release --test orphan_cleanup \
//!     -- --ignored --nocapture

use common::config::Config;
use index::deletion::delete_orphan_artists;
use sqlx::PgPool;

const LRA_NAME: &str = "DMP Test LRA Artist (orphan_cleanup)";
const MBRA_NAME: &str = "DMP Test MBRA Artist (orphan_cleanup)";
const CREDIT_ONLY_NAME: &str = "DMP Test Credit Only Artist (orphan_cleanup)";
const LONE_NAME: &str = "DMP Test Unlinked Artist (orphan_cleanup)";
const RELEASE_TYPE_NAME: &str = "DMP Test Release Type (orphan_cleanup)";

/// Config with local image storage pointed at a throwaway dir: the fixture artists carry no image,
/// so `delete_artist_images` finds nothing to unlink, but S3 must stay off regardless.
fn test_config() -> Config {
    Config {
        music_dir: None,
        music_dir_locked: false,
        database_url: String::new(),
        project_root: ".".to_string(),
        image_dir: std::env::temp_dir()
            .join("dmp-orphan-cleanup-img")
            .to_string_lossy()
            .to_string(),
        image_storage: "local".to_string(),
        storage_bucket: None,
        s3_region: None,
        s3_access_key: None,
        s3_secret_key: None,
        storage_endpoint: None,
        storage_public_url: None,
        fanart_api_key: None,
    }
}

async fn insert_artist(pool: &PgPool, name: &str) -> String {
    let id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "Artist" (id, name, slug, "totalPlayCount", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 0, 0, 0, now(), now())"#,
    )
    .bind(&id)
    .bind(name)
    .bind(common::slug::make_slug(name))
    .execute(pool)
    .await
    .expect("insert fixture Artist");
    id
}

async fn artist_exists(pool: &PgPool, id: &str) -> bool {
    sqlx::query_scalar::<_, bool>(r#"SELECT EXISTS(SELECT 1 FROM "Artist" WHERE id = $1)"#)
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("artist existence query")
}

/// Drop anything left behind by an earlier run (a failing assertion skips the cleanup at the end), so
/// the test is re-runnable against the same scratch database.
async fn reset_fixture(pool: &PgPool) {
    sqlx::query(
        r#"DELETE FROM "LocalRelease" WHERE "groupKey" LIKE 'folder:orphan-cleanup-fixture/%'"#,
    )
    .execute(pool)
    .await
    .expect("clear fixture local releases");
    sqlx::query(
        r#"DELETE FROM "MusicBrainzRelease" WHERE title = 'Orphan Cleanup Fixture MB Release'"#,
    )
    .execute(pool)
    .await
    .expect("clear fixture MB releases");
    sqlx::query(r#"DELETE FROM "ReleaseType" WHERE name = $1"#)
        .bind(RELEASE_TYPE_NAME)
        .execute(pool)
        .await
        .expect("clear fixture release type");
    sqlx::query(r#"DELETE FROM "Artist" WHERE slug = ANY($1::text[])"#)
        .bind(vec![
            common::slug::make_slug(LRA_NAME),
            common::slug::make_slug(MBRA_NAME),
            common::slug::make_slug(CREDIT_ONLY_NAME),
            common::slug::make_slug(LONE_NAME),
        ])
        .execute(pool)
        .await
        .expect("clear fixture artists");
}

#[tokio::test]
#[ignore]
async fn credits_and_release_links_both_protect_an_artist() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
        "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
         against the production DATABASE_URL",
    );
    let pool = common::db::create_pool(&db_url).await;
    let config = test_config();
    reset_fixture(&pool).await;

    let lra_id = insert_artist(&pool, LRA_NAME).await;
    let mbra_id = insert_artist(&pool, MBRA_NAME).await;
    let credit_only_id = insert_artist(&pool, CREDIT_ONLY_NAME).await;
    let lone_id = insert_artist(&pool, LONE_NAME).await;

    // LRA_NAME: protected by a LocalReleaseArtist link.
    let release_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
           VALUES ($1, 'Orphan Cleanup Fixture', 2020, $2, $3, now(), now())"#,
    )
    .bind(&release_id)
    .bind(format!("folder:orphan-cleanup-fixture/{}", release_id))
    .bind(format!("orphan-cleanup-fixture/{}", release_id))
    .execute(&pool)
    .await
    .expect("insert fixture LocalRelease");

    sqlx::query(
        r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
           VALUES ($1, $2, $3, now())"#,
    )
    .bind(cuid2::create_id())
    .bind(&release_id)
    .bind(&lra_id)
    .execute(&pool)
    .await
    .expect("insert fixture LocalReleaseArtist");

    // A track on that release credits CREDIT_ONLY_NAME through TrackRelatedArtist ONLY - the artist
    // owns nothing, so the credit is the single thing keeping it alive.
    let track_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalReleaseTrack"
             (id, title, artist, "albumArtist", album, "filePath", "localReleaseId", "playCount",
              "createdAt", "updatedAt")
           VALUES ($1, 'Fixture Track', $2, $3, 'Orphan Cleanup Fixture', $4, $5, 0, now(), now())"#,
    )
    .bind(&track_id)
    .bind(format!("{} feat. {}", LRA_NAME, CREDIT_ONLY_NAME))
    .bind(LRA_NAME)
    .bind(format!("orphan-cleanup-fixture/{}/01.mp3", release_id))
    .bind(&release_id)
    .execute(&pool)
    .await
    .expect("insert fixture LocalReleaseTrack");

    sqlx::query(
        r#"INSERT INTO "TrackRelatedArtist" (id, "trackId", "artistId", "createdAt")
           VALUES ($1, $2, $3, now())"#,
    )
    .bind(cuid2::create_id())
    .bind(&track_id)
    .bind(&credit_only_id)
    .execute(&pool)
    .await
    .expect("insert fixture TrackRelatedArtist");

    // MBRA_NAME: protected by a MusicBrainzReleaseArtist link (needs a minimal ReleaseType +
    // MusicBrainzRelease to satisfy the FK chain).
    let release_type_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "ReleaseType" (id, name, slug, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, now(), now())"#,
    )
    .bind(&release_type_id)
    .bind(RELEASE_TYPE_NAME)
    .bind(common::slug::make_slug(RELEASE_TYPE_NAME))
    .execute(&pool)
    .await
    .expect("insert fixture ReleaseType");

    let mb_release_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "MusicBrainzRelease"
             (id, title, "typeId", "musicbrainzId", "createdAt", "updatedAt")
           VALUES ($1, 'Orphan Cleanup Fixture MB Release', $2, $3, now(), now())"#,
    )
    .bind(&mb_release_id)
    .bind(&release_type_id)
    .bind(cuid2::create_id())
    .execute(&pool)
    .await
    .expect("insert fixture MusicBrainzRelease");

    sqlx::query(
        r#"INSERT INTO "MusicBrainzReleaseArtist" (id, "releaseId", "artistId", "createdAt")
           VALUES ($1, $2, $3, now())"#,
    )
    .bind(cuid2::create_id())
    .bind(&mb_release_id)
    .bind(&mbra_id)
    .execute(&pool)
    .await
    .expect("insert fixture MusicBrainzReleaseArtist");

    delete_orphan_artists(&pool, &config).await;

    assert!(
        artist_exists(&pool, &lra_id).await,
        "artist with a LocalReleaseArtist link was deleted"
    );
    assert!(
        artist_exists(&pool, &mbra_id).await,
        "artist with a MusicBrainzReleaseArtist link was deleted"
    );
    assert!(
        artist_exists(&pool, &credit_only_id).await,
        "credit-only artist was deleted - a TrackRelatedArtist credit must keep an artist alive, or \
         every MB-verified 'appears on' artist vanishes on the next cleanup pass"
    );
    assert!(
        !artist_exists(&pool, &lone_id).await,
        "artist with no links at all should have been deleted"
    );

    // ...but once the credit itself is gone (track deleted -> cascade), the artist becomes collectable.
    sqlx::query(r#"DELETE FROM "LocalReleaseTrack" WHERE id = $1"#)
        .bind(&track_id)
        .execute(&pool)
        .await
        .expect("delete fixture track");
    delete_orphan_artists(&pool, &config).await;
    assert!(
        !artist_exists(&pool, &credit_only_id).await,
        "artist kept alive after its last credit disappeared - the cleanup would leak rows forever"
    );

    reset_fixture(&pool).await;
}
