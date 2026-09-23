//! `./delete --release`: must remove exactly one release without disturbing the rest of the
//! catalogue - most importantly, a MusicBrainz edition still bound to a DUPLICATE copy must survive
//! deleting one of the copies.
//!
//! `#[ignore]`d integration test - point it at a disposable, migrated Postgres, never production:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p delete --release --test delete_release \
//!     -- --ignored --nocapture

use delete::release::{build_plan, execute_plan, mb_is_orphaned, MbVerdict};
use sqlx::PgPool;

const PREFIX: &str = "delete-release-fixture";

struct Ctx {
    pool: PgPool,
    tag: String,
    album_type_id: String,
}

impl Ctx {
    async fn new(tag: &str) -> Self {
        let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
            "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
             against the production DATABASE_URL",
        );
        let pool = common::db::create_pool(&db_url).await;
        let album_type_id: String = sqlx::query_scalar(
            r#"INSERT INTO "ReleaseType" (id, name, slug, "createdAt", "updatedAt")
               VALUES ('release-type-album', 'Album', 'album', now(), now())
               ON CONFLICT (name) DO UPDATE SET "updatedAt" = now()
               RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .expect("ensure release type");

        let ctx = Self {
            pool,
            tag: tag.to_string(),
            album_type_id,
        };
        ctx.reset().await;
        ctx
    }

    fn scope(&self) -> String {
        format!("{}-{}", PREFIX, self.tag)
    }

    async fn reset(&self) {
        sqlx::query(r#"DELETE FROM "LocalRelease" WHERE "groupKey" LIKE $1"#)
            .bind(format!("folder:{}/%", self.scope()))
            .execute(&self.pool)
            .await
            .expect("clear releases");
        sqlx::query(r#"DELETE FROM "MusicBrainzRelease" WHERE "musicbrainzId" LIKE $1"#)
            .bind(format!("{}-%", self.scope()))
            .execute(&self.pool)
            .await
            .expect("clear mb releases");
        sqlx::query(r#"DELETE FROM "Artist" WHERE name LIKE $1"#)
            .bind(format!("DMP {} %", self.scope()))
            .execute(&self.pool)
            .await
            .expect("clear artists");
    }

    async fn artist(&self, name: &str) -> String {
        common::db::ensure_artist(&self.pool, &format!("DMP {} {}", self.scope(), name))
            .await
            .expect("artist")
    }

    async fn mb_release(&self, suffix: &str, status: &str) -> String {
        let id = cuid2::create_id();
        let mbid = format!("{}-{}", self.scope(), suffix);
        sqlx::query(
            r#"INSERT INTO "MusicBrainzRelease"
                 (id, title, "typeId", "musicbrainzId", "releaseGroupId", status, "mediumCount",
                  "releaseGroupSecondaryTypes", "createdAt", "updatedAt")
               VALUES ($1, 'Fixture Release', $2, $3, $3, $4::"ReleaseStatus", 1, '{}', now(), now())"#,
        )
        .bind(&id)
        .bind(&self.album_type_id)
        .bind(&mbid)
        .bind(status)
        .execute(&self.pool)
        .await
        .expect("insert mb release");
        id
    }

    async fn local_release(&self, suffix: &str, release_id: Option<&str>) -> String {
        let id = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "releaseId", "createdAt", "updatedAt")
               VALUES ($1, 'Fixture', 2020, $2, $3, $4, now(), now())"#,
        )
        .bind(&id)
        .bind(format!("folder:{}/{}", self.scope(), suffix))
        .bind(format!("{}/{}", self.scope(), suffix))
        .bind(release_id)
        .execute(&self.pool)
        .await
        .expect("insert local release");
        id
    }

    async fn own(&self, local_release_id: &str, artist_id: &str) {
        sqlx::query(
            r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
               VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING"#,
        )
        .bind(cuid2::create_id())
        .bind(local_release_id)
        .bind(artist_id)
        .execute(&self.pool)
        .await
        .expect("insert owner");
    }

    async fn mb_release_exists(&self, id: &str) -> bool {
        sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(SELECT 1 FROM "MusicBrainzRelease" WHERE id = $1)"#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .expect("exists query")
    }

    async fn local_release_exists(&self, id: &str) -> bool {
        sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(SELECT 1 FROM "LocalRelease" WHERE id = $1)"#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .expect("exists query")
    }

    async fn artist_exists(&self, id: &str) -> bool {
        sqlx::query_scalar::<_, bool>(r#"SELECT EXISTS(SELECT 1 FROM "Artist" WHERE id = $1)"#)
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .expect("exists query")
    }

    /// Runs the same plan -> orphan-check -> execute sequence `release::run` performs, skipping the
    /// interactive/lock/image/statistics side effects that don't matter to these assertions.
    async fn delete_release(&self, local_release_id: &str) {
        let plan = build_plan(&self.pool, local_release_id)
            .await
            .expect("plan");
        let mut verdicts = Vec::new();
        for mb_id in &plan.mb_candidates {
            let orphaned = mb_is_orphaned(&self.pool, mb_id, &plan.id).await;
            verdicts.push(MbVerdict {
                id: mb_id.clone(),
                orphaned,
            });
        }
        execute_plan(&self.pool, &plan, &verdicts)
            .await
            .expect("execute plan");
    }
}

#[tokio::test]
#[ignore]
async fn deleting_one_duplicate_copy_keeps_the_shared_mb_edition() {
    let c = Ctx::new("duplicate").await;
    let artist = c.artist("Duplicate Owner").await;
    let mb = c.mb_release("dup", "COMPLETE").await;
    let copy_a = c.local_release("copy-a", Some(&mb)).await;
    let copy_b = c.local_release("copy-b", Some(&mb)).await;
    c.own(&copy_a, &artist).await;
    c.own(&copy_b, &artist).await;

    c.delete_release(&copy_a).await;

    assert!(
        !c.local_release_exists(&copy_a).await,
        "the deleted copy must be gone"
    );
    assert!(
        c.local_release_exists(&copy_b).await,
        "the surviving duplicate must be untouched"
    );
    assert!(
        c.mb_release_exists(&mb).await,
        "the shared MB edition must survive - the other copy still points at it"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn deleting_a_sole_copy_drops_its_orphaned_mb_edition() {
    let c = Ctx::new("sole").await;
    let artist = c.artist("Sole Owner").await;
    let mb = c.mb_release("sole", "COMPLETE").await;
    let copy = c.local_release("sole", Some(&mb)).await;
    c.own(&copy, &artist).await;

    c.delete_release(&copy).await;

    assert!(!c.local_release_exists(&copy).await);
    assert!(
        !c.mb_release_exists(&mb).await,
        "an edition nothing else needs must be dropped"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn a_missing_placeholder_is_never_touched() {
    let c = Ctx::new("missing").await;
    let artist = c.artist("Placeholder Owner").await;
    let owned_mb = c.mb_release("owned", "COMPLETE").await;
    let missing_mb = c.mb_release("missing", "MISSING").await;
    let copy = c.local_release("owned", Some(&owned_mb)).await;
    c.own(&copy, &artist).await;

    c.delete_release(&copy).await;

    assert!(!c.local_release_exists(&copy).await);
    assert!(
        !c.mb_release_exists(&owned_mb).await,
        "the now-orphaned owned edition is dropped"
    );
    assert!(
        c.mb_release_exists(&missing_mb).await,
        "a MISSING placeholder is never swept by a release delete, even an unrelated one"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn a_sibling_release_of_the_same_artist_is_untouched() {
    let c = Ctx::new("sibling").await;
    let artist = c.artist("Multi Release Owner").await;
    let mb_a = c.mb_release("a", "COMPLETE").await;
    let mb_b = c.mb_release("b", "COMPLETE").await;
    let release_a = c.local_release("a", Some(&mb_a)).await;
    let release_b = c.local_release("b", Some(&mb_b)).await;
    c.own(&release_a, &artist).await;
    c.own(&release_b, &artist).await;

    c.delete_release(&release_a).await;

    assert!(!c.local_release_exists(&release_a).await);
    assert!(
        c.local_release_exists(&release_b).await,
        "a sibling release must be left alone"
    );
    assert!(c.mb_release_exists(&mb_b).await);
    assert!(
        c.artist_exists(&artist).await,
        "the artist still owns release_b and must survive"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn an_owner_left_with_nothing_is_swept_but_a_multi_release_owner_survives() {
    let c = Ctx::new("sweep").await;
    let sole_owner = c.artist("Sole Credit Owner").await;
    let multi_owner = c.artist("Multi Credit Owner").await;
    let mb = c.mb_release("sweep", "COMPLETE").await;
    let mb_other = c.mb_release("sweep-other", "COMPLETE").await;
    let release = c.local_release("sweep", Some(&mb)).await;
    let other_release = c.local_release("sweep-other", Some(&mb_other)).await;
    c.own(&release, &sole_owner).await;
    c.own(&release, &multi_owner).await;
    c.own(&other_release, &multi_owner).await;

    let plan = build_plan(&c.pool, &release).await.expect("plan");
    c.delete_release(&release).await;

    // What `release::run` does after `execute_plan`, minus the interactive/lock/S3/statistics parts.
    let mut touched: Vec<String> = plan.owner_artist_ids.clone();
    touched.sort();
    touched.dedup();
    // A literal Config, never `load_config` - this test must never touch web/.env's live prod
    // DATABASE_URL even just by reading the string. Local-storage settings only: the artist has no
    // image fixture here, so this crate never actually touches disk.
    let config = common::config::Config {
        music_dir: None,
        music_dir_locked: false,
        database_url: String::new(),
        project_root: ".".to_string(),
        image_dir: std::env::temp_dir().to_string_lossy().to_string(),
        image_storage: "local".to_string(),
        storage_bucket: None,
        s3_region: None,
        s3_access_key: None,
        s3_secret_key: None,
        storage_endpoint: None,
        storage_public_url: None,
        fanart_api_key: None,
    };
    index::deletion::delete_orphan_artists(&c.pool, &config, Some(&touched)).await;

    assert!(
        !c.artist_exists(&sole_owner).await,
        "an artist left owning nothing and credited nowhere must be swept"
    );
    assert!(
        c.artist_exists(&multi_owner).await,
        "an artist who still owns another release must survive"
    );

    c.reset().await;
}
