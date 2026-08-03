//! The orphaned-release sweep must only touch releases the delete actually orphaned.
//!
//! This guards a real blast-radius bug: the local sweep used to be unscoped, deleting *every*
//! ownerless `LocalRelease` in the library. That is destructive during an index run, where releases
//! are legitimately ownerless between the folder scan and the artist-resolution pass.
//!
//! `#[ignore]`d integration test - point it at a disposable, migrated Postgres, never production:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p delete --release --test delete_plan \
//!     -- --ignored --nocapture

use delete::sweep::sweep_orphaned_releases;
use sqlx::PgPool;

const PREFIX: &str = "delete-sweep-fixture";

struct Ctx {
    pool: PgPool,
    tag: String,
}

impl Ctx {
    /// Each test gets its own `tag` so the fixtures never collide - these tests run concurrently,
    /// and a shared prefix means one test's `reset()` deletes the other's artists mid-run.
    async fn new(tag: &str) -> Self {
        let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
            "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
             against the production DATABASE_URL",
        );
        let ctx = Self {
            pool: common::db::create_pool(&db_url).await,
            tag: tag.to_string(),
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
        sqlx::query(r#"DELETE FROM "Artist" WHERE name LIKE $1"#)
            .bind(format!("DMP {} %", self.scope()))
            .execute(&self.pool)
            .await
            .expect("clear artists");
    }

    async fn release(&self, suffix: &str) -> String {
        let id = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
               VALUES ($1, 'Sweep Fixture', 2020, $2, $3, now(), now())"#,
        )
        .bind(&id)
        .bind(format!("folder:{}/{}", self.scope(), suffix))
        .bind(format!("{}/{}", self.scope(), suffix))
        .execute(&self.pool)
        .await
        .expect("insert release");
        id
    }

    async fn own(&self, release_id: &str, artist_name: &str) {
        let artist_id =
            common::db::ensure_artist(&self.pool, &format!("DMP {} {}", self.scope(), artist_name))
                .await
                .expect("artist");
        sqlx::query(
            r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
               VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING"#,
        )
        .bind(cuid2::create_id())
        .bind(release_id)
        .bind(&artist_id)
        .execute(&self.pool)
        .await
        .expect("insert owner");
    }

    async fn exists(&self, release_id: &str) -> bool {
        sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(SELECT 1 FROM "LocalRelease" WHERE id = $1)"#,
        )
        .bind(release_id)
        .fetch_one(&self.pool)
        .await
        .expect("exists query")
    }
}

#[tokio::test]
#[ignore]
async fn sweep_deletes_only_the_releases_it_orphaned() {
    let c = Ctx::new("scoped").await;

    // In the deletion set and now ownerless - this is what the sweep exists to remove.
    let orphaned_in_scope = c.release("orphaned-in-scope").await;
    // In the deletion set but still owned by an artist that survived - must be kept.
    let owned_in_scope = c.release("owned-in-scope").await;
    c.own(&owned_in_scope, "Survivor").await;
    // NOT in the deletion set and ownerless - e.g. mid-index, awaiting the resolution pass.
    // The old unscoped query destroyed exactly this.
    let orphaned_out_of_scope = c.release("orphaned-out-of-scope").await;

    let scope = vec![orphaned_in_scope.clone(), owned_in_scope.clone()];
    let mut tx = c.pool.begin().await.expect("begin");
    sweep_orphaned_releases(&mut tx, &scope, &[])
        .await
        .expect("sweep failed");
    tx.commit().await.expect("commit");

    assert!(
        !c.exists(&orphaned_in_scope).await,
        "an in-scope ownerless release should be swept"
    );
    assert!(
        c.exists(&owned_in_scope).await,
        "an in-scope release that still has an owner must survive"
    );
    assert!(
        c.exists(&orphaned_out_of_scope).await,
        "an ownerless release OUTSIDE the deletion set must survive - deleting one artist must \
         never garbage-collect unrelated releases"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn empty_scope_sweeps_nothing() {
    let c = Ctx::new("empty").await;
    let untouched = c.release("empty-scope").await;

    let mut tx = c.pool.begin().await.expect("begin");
    sweep_orphaned_releases(&mut tx, &[], &[])
        .await
        .expect("sweep failed");
    tx.commit().await.expect("commit");

    assert!(
        c.exists(&untouched).await,
        "a delete that orphaned nothing must sweep nothing"
    );

    c.reset().await;
}
