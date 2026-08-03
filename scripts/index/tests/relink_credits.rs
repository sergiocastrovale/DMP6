//! Regression test for `relink_track_credits`, the pass that rebuilds `TrackRelatedArtist` after every
//! index run. Under the "no credit-only artists" model, a credit is kept ONLY when the credited name
//! resolves to an artist that already owns a release - never created speculatively - so the pass must:
//!   1. drop a credit whose name doesn't (yet) match any existing artist,
//!   2. pick that same credit back up once the target artist gets its own release (this is what makes
//!      folder-scan order irrelevant: an artist indexed after the release that credits it still ends up
//!      linked once this pass runs),
//!   3. never credit an artist on its own release's tracks (self-credit guard), and
//!   4. remove a stale credit once retagging drops the name from the track's `artist` tag - the pass
//!      always re-derives from current state, it doesn't just accumulate.
//!
//! Like `sync`'s `catalogue_smoke.rs`, this is an integration test against a REAL Postgres, so it is
//! `#[ignore]`d and never runs on a plain `cargo test`. Point it at a disposable, migrated database -
//! never the production `DATABASE_URL`, it writes and deletes rows:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p index --release --test relink_credits \
//!     -- --ignored --nocapture

use index::db::relink_track_credits;
use sqlx::PgPool;

const ARTIST_A: &str = "DMP Test Artist A (relink_credits)";
const ARTIST_B: &str = "DMP Test Artist B (relink_credits)";

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

async fn insert_release(pool: &PgPool, folder: &str, title: &str, artist_ids: &[&str]) -> String {
    let release_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
           VALUES ($1, $2, 2020, $3, $4, now(), now())"#,
    )
    .bind(&release_id)
    .bind(title)
    .bind(format!("folder:{}", folder))
    .bind(folder)
    .execute(pool)
    .await
    .expect("insert fixture LocalRelease");

    for artist_id in artist_ids {
        sqlx::query(
            r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
               VALUES ($1, $2, $3, now())"#,
        )
        .bind(cuid2::create_id())
        .bind(&release_id)
        .bind(artist_id)
        .execute(pool)
        .await
        .expect("insert fixture LocalReleaseArtist");
    }

    release_id
}

async fn insert_track(pool: &PgPool, release_id: &str, file_path: &str, artist_tag: &str, album_artist_tag: &str) -> String {
    let track_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalReleaseTrack"
             (id, title, artist, "albumArtist", album, "filePath", "localReleaseId", "playCount",
              "createdAt", "updatedAt")
           VALUES ($1, 'Fixture Track', $2, $3, 'Relink Credits Fixture', $4, $5, 0, now(), now())"#,
    )
    .bind(&track_id)
    .bind(artist_tag)
    .bind(album_artist_tag)
    .bind(file_path)
    .bind(release_id)
    .execute(pool)
    .await
    .expect("insert fixture LocalReleaseTrack");
    track_id
}

async fn set_track_artist_tag(pool: &PgPool, track_id: &str, artist_tag: &str) {
    sqlx::query(r#"UPDATE "LocalReleaseTrack" SET artist = $1 WHERE id = $2"#)
        .bind(artist_tag)
        .bind(track_id)
        .execute(pool)
        .await
        .expect("update fixture track artist tag");
}

async fn credit_exists(pool: &PgPool, track_id: &str, artist_id: &str) -> bool {
    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(SELECT 1 FROM "TrackRelatedArtist" WHERE "trackId" = $1 AND "artistId" = $2)"#,
    )
    .bind(track_id)
    .bind(artist_id)
    .fetch_one(pool)
    .await
    .expect("credit existence query")
}

/// Drop anything left behind by an earlier run (a failing assertion skips the cleanup at the end), so
/// the test is re-runnable against the same scratch database.
async fn reset_fixture(pool: &PgPool) {
    sqlx::query(r#"DELETE FROM "LocalRelease" WHERE "groupKey" LIKE 'folder:relink-credits-fixture/%'"#)
        .execute(pool)
        .await
        .expect("clear fixture releases");
    sqlx::query(r#"DELETE FROM "Artist" WHERE slug = ANY($1::text[])"#)
        .bind(vec![common::slug::make_slug(ARTIST_A), common::slug::make_slug(ARTIST_B)])
        .execute(pool)
        .await
        .expect("clear fixture artists");
}

#[tokio::test]
#[ignore]
async fn credits_resolve_once_artist_exists_and_never_self_credit() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
        "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
         against the production DATABASE_URL",
    );
    let pool = common::db::create_pool(&db_url).await;
    reset_fixture(&pool).await;

    let artist_a = insert_artist(&pool, ARTIST_A).await;
    let release_a = insert_release(&pool, "relink-credits-fixture/album-a", "Album A", &[&artist_a]).await;
    let track = insert_track(
        &pool,
        &release_a,
        "relink-credits-fixture/album-a/01.mp3",
        &format!("{} feat. {}", ARTIST_A, ARTIST_B),
        ARTIST_A,
    )
    .await;

    // Phase 1: B doesn't exist yet - the credit must be dropped, not speculatively created.
    relink_track_credits(&pool).await;
    let artist_b_slug = common::slug::make_slug(ARTIST_B);
    let artist_b_exists_yet: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM "Artist" WHERE slug = $1)"#,
    )
    .bind(&artist_b_slug)
    .fetch_one(&pool)
    .await
    .expect("artist B existence query");
    assert!(!artist_b_exists_yet, "relink_track_credits must never create an Artist row for a credit");

    // Phase 2: B is indexed later (gets its own release) - the SAME track's credit must now resolve,
    // proving folder-scan order doesn't matter.
    let artist_b = insert_artist(&pool, ARTIST_B).await;
    insert_release(&pool, "relink-credits-fixture/album-b", "Album B", &[&artist_b]).await;

    relink_track_credits(&pool).await;
    assert!(
        credit_exists(&pool, &track, &artist_b).await,
        "credit to B did not resolve after B gained its own release"
    );
    assert!(
        !credit_exists(&pool, &track, &artist_a).await,
        "track must never credit its own release's artist (self-credit)"
    );

    // Phase 3: explicit self-credit guard - a compilation-style release owned by BOTH A and B, whose
    // track's artist tag is just "B", must not produce a B->B... it must not link B to its OWN release.
    let comp_release = insert_release(
        &pool,
        "relink-credits-fixture/compilation",
        "Compilation",
        &[&artist_a, &artist_b],
    )
    .await;
    let comp_track = insert_track(
        &pool,
        &comp_release,
        "relink-credits-fixture/compilation/01.mp3",
        ARTIST_B,
        "Various Artists",
    )
    .await;
    relink_track_credits(&pool).await;
    assert!(
        !credit_exists(&pool, &comp_track, &artist_b).await,
        "B must not be credited on a release it already owns as a main artist"
    );

    // Phase 4: retagging away from B must remove the now-stale credit, not just leave it accumulated.
    set_track_artist_tag(&pool, &track, ARTIST_A).await;
    relink_track_credits(&pool).await;
    assert!(
        !credit_exists(&pool, &track, &artist_b).await,
        "stale credit survived after the artist tag no longer mentions B"
    );

    reset_fixture(&pool).await;
}
