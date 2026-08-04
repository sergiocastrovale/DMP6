//! Ownership reconcile: the resolver, not the raw `albumArtist` tag, decides who owns a release.
//!
//! The folder scan may write the verbatim tag as a *provisional* owner when it cannot resolve the name
//! offline (cold cache). This pass must replace that with the artists the tag actually names - while
//! never leaving a release ownerless, because an ownerless release is invisible in `/browse`,
//! unsyncable, and was previously deletable by `./delete`'s sweep.
//!
//! `#[ignore]`d integration test - point it at a disposable, migrated Postgres, never production:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p index --release --test owner_reconcile \
//!     -- --ignored --nocapture

use index::resolve::{resolve_and_apply, ArtistResolver, Decision};
use sqlx::PgPool;

const PREFIX: &str = "owner-reconcile-fixture";

struct Ctx {
    pool: PgPool,
    tag: String,
}

impl Ctx {
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

    fn folder(&self) -> String {
        format!("{}-{}", PREFIX, self.tag)
    }

    fn artist(&self, name: &str) -> String {
        format!("DMP {} {} (owner_reconcile)", self.tag, name)
    }

    async fn reset(&self) {
        sqlx::query(r#"DELETE FROM "LocalRelease" WHERE "groupKey" LIKE $1"#)
            .bind(format!("folder:{}/%", self.folder()))
            .execute(&self.pool)
            .await
            .expect("clear releases");
        sqlx::query(r#"DELETE FROM "Artist" WHERE name LIKE $1"#)
            .bind(format!("DMP {} %(owner_reconcile)", self.tag))
            .execute(&self.pool)
            .await
            .expect("clear artists");
    }

    async fn release(&self, suffix: &str) -> String {
        let id = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
               VALUES ($1, 'Reconcile Fixture', 2020, $2, $3, now(), now())"#,
        )
        .bind(&id)
        .bind(format!("folder:{}/{}", self.folder(), suffix))
        .bind(format!("{}/{}", self.folder(), suffix))
        .execute(&self.pool)
        .await
        .expect("insert release");
        id
    }

    async fn own(&self, release_id: &str, artist_name: &str) -> String {
        let artist_id = common::db::ensure_artist(&self.pool, artist_name)
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
        artist_id
    }

    /// A track carrying `album_artist`, plus the embedded album-artist pairing that lets the resolver
    /// decide offline (so these tests need no network).
    async fn track(
        &self,
        release_id: &str,
        n: u32,
        album_artist: &str,
        album_artists: &[&str],
        mb_ids: &[&str],
    ) -> String {
        let id = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalReleaseTrack"
                 (id, title, artist, "albumArtist", album, "filePath", "localReleaseId", "playCount",
                  "albumArtists", "mbAlbumArtistIds", "createdAt", "updatedAt")
               VALUES ($1, 'T', $2, $2, 'Reconcile Fixture', $3, $4, 0, $5, $6, now(), now())"#,
        )
        .bind(&id)
        .bind(album_artist)
        .bind(format!("{}/{}/{:02}.mp3", self.folder(), release_id, n))
        .bind(release_id)
        .bind(album_artists.iter().map(|s| s.to_string()).collect::<Vec<_>>())
        .bind(mb_ids.iter().map(|s| s.to_string()).collect::<Vec<_>>())
        .execute(&self.pool)
        .await
        .expect("insert track");
        id
    }

    async fn owners(&self, release_id: &str) -> Vec<String> {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT a.name FROM "LocalReleaseArtist" l JOIN "Artist" a ON a.id = l."artistId"
               WHERE l."localReleaseId" = $1 ORDER BY a.name"#,
        )
        .bind(release_id)
        .fetch_all(&self.pool)
        .await
        .expect("owners query");
        rows.into_iter().map(|(n,)| n).collect()
    }

    /// Run the pass offline - every decision comes from the embedded pairing, so no MB call happens.
    async fn run(&self, release_ids: &[String]) {
        let mut resolver = ArtistResolver::new(&self.pool, false);
        resolver.offline = true;
        let mut report: Vec<Decision> = Vec::new();
        resolve_and_apply(&self.pool, &mut resolver, Some(release_ids), &mut report, None)
            .await
            .expect("resolution failed");
    }
}

const MBID_A: &str = "11111111-1111-4111-8111-111111111111";
const MBID_B: &str = "22222222-2222-4222-8222-222222222222";

#[tokio::test]
#[ignore]
async fn compound_provisional_owner_is_replaced_by_the_artists_it_names() {
    let c = Ctx::new("split").await;
    let (a, b) = (c.artist("Ella"), c.artist("Roy"));
    let compound = format!("{} & {}", a, b);

    let release = c.release("r1").await;
    // What the folder scan writes with a cold cache: the raw tag as a provisional owner.
    c.own(&release, &compound).await;
    c.track(&release, 1, &compound, &[&a, &b], &[MBID_A, MBID_B])
        .await;

    c.run(&[release.clone()]).await;

    let owners = c.owners(&release).await;
    assert_eq!(
        owners,
        vec![a.clone(), b.clone()],
        "release should be owned by the two real artists"
    );
    assert!(
        !owners.contains(&compound),
        "the provisional compound must lose ownership"
    );
    assert!(!owners.is_empty(), "a release must never end up ownerless");

    c.reset().await;
}

/// The dangerous deferral case: a release carrying TWO album artists where one resolves and the other
/// does not. Without the guard the reconcile would compute its desired set from only the half that
/// resolved and delete the other half's owner - silently stripping a co-owner because MusicBrainz
/// happened to be down. (A release where the *only* album artist defers is already safe by a different
/// route: nothing resolves, so there is no desired set to reconcile against.)
#[tokio::test]
#[ignore]
async fn a_partially_deferred_release_keeps_every_owner() {
    let c = Ctx::new("defer").await;
    let resolvable = c.artist("Resolvable");
    let deferring = c.artist("Unresolvable Duo");

    let release = c.release("r1").await;
    let deferring_id = c.own(&release, &deferring).await;
    // Track 1 resolves offline from its embedded pairing...
    c.track(&release, 1, &resolvable, &[&resolvable], &[MBID_A])
        .await;
    // ...track 2 has no pairing, so it needs MusicBrainz; offline mode turns that into Deferred.
    c.track(&release, 2, &deferring, &[], &[]).await;

    c.run(&[release.clone()]).await;

    let owners = c.owners(&release).await;
    assert!(
        owners.contains(&deferring),
        "the deferred album artist's owner was deleted on an incomplete picture - owners were {owners:?}"
    );
    assert!(!owners.is_empty(), "a release must never end up ownerless");

    // Sanity: that owner really is still linked, not just similarly named.
    let still_linked: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM "LocalReleaseArtist" WHERE "localReleaseId" = $1 AND "artistId" = $2)"#,
    )
    .bind(&release)
    .bind(&deferring_id)
    .fetch_one(&c.pool)
    .await
    .expect("link query");
    assert!(still_linked);

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn a_multi_album_artist_compilation_keeps_every_owner() {
    let c = Ctx::new("comp").await;
    let (a, b) = (c.artist("First"), c.artist("Second"));

    let release = c.release("r1").await;
    // Per-source-tagged compilation: two tracks, two different albumArtist tags, one release.
    c.track(&release, 1, &a, &[&a], &[MBID_A]).await;
    c.track(&release, 2, &b, &[&b], &[MBID_B]).await;

    c.run(&[release.clone()]).await;

    let owners = c.owners(&release).await;
    assert!(owners.contains(&a), "first album artist must own it");
    assert!(
        owners.contains(&b),
        "second album artist must survive - the desired set is a union across the release's tracks, \
         not an overwrite from one of them"
    );

    c.reset().await;
}

#[tokio::test]
#[ignore]
async fn various_artists_release_is_left_alone() {
    let c = Ctx::new("va").await;
    let placeholder = c.artist("Comp Owner");

    let release = c.release("r1").await;
    c.own(&release, &placeholder).await;
    // "Various Artists" resolves to nothing at all, so there is no desired set to reconcile against.
    c.track(&release, 1, "Various Artists", &[], &[]).await;

    c.run(&[release.clone()]).await;

    assert_eq!(
        c.owners(&release).await,
        vec![placeholder.clone()],
        "a Various Artists release must keep the owner the folder scan established"
    );

    c.reset().await;
}
