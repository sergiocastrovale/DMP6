//! End-to-end test for the artist-resolution pass against a real Postgres.
//!
//! Covers the two things the unit tests in `common::mb::resolve` cannot: that tier 0 (the file's own
//! `artists[]` / `mbArtistIds[]` pairing) resolves with **zero** network calls, and that the join
//! phrase actually lands in the DB as the right relationship - `"Frank Sinatra with Count Basie"`
//! must leave Sinatra owning the release and Basie merely credited on the track.
//!
//! `#[ignore]`d like the other integration tests. Point it at a disposable, migrated database - never
//! the production `DATABASE_URL`:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p index --release --test resolve_artists \
//!     -- --ignored --nocapture

use index::resolve::{resolve_and_apply, ArtistResolver, Decision};
use sqlx::PgPool;

const OWNER_MBID: &str = "11111111-1111-4111-8111-111111111111";
const GUEST_MBID: &str = "22222222-2222-4222-8222-222222222222";

// Cargo runs #[tokio::test]s concurrently, so each test owns a private set of fixture names and a
// private folder prefix - otherwise one test's cleanup deletes the other's rows mid-run.
struct Fixture {
    owner: String,
    guest: String,
    prefix: String,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        Self {
            owner: format!("DMP Test Owner {} (resolve_artists)", tag),
            guest: format!("DMP Test Guest {} (resolve_artists)", tag),
            prefix: format!("resolve-fixture-{}", tag),
        }
    }
}

async fn reset(pool: &PgPool, f: &Fixture) {
    sqlx::query(r#"DELETE FROM "LocalRelease" WHERE "groupKey" LIKE $1"#)
        .bind(format!("folder:{}/%", f.prefix))
        .execute(pool)
        .await
        .expect("clear releases");
    sqlx::query(r#"DELETE FROM "Artist" WHERE slug = ANY($1::text[])"#)
        .bind(vec![
            common::slug::make_slug(&f.owner),
            common::slug::make_slug(&f.guest),
        ])
        .execute(pool)
        .await
        .expect("clear artists");
}

#[tokio::test]
#[ignore]
async fn embedded_pairing_resolves_owner_and_credit_without_network() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
        "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
         against the production DATABASE_URL",
    );
    let pool = common::db::create_pool(&db_url).await;
    let f = Fixture::new("embedded");
    let (owner_name, guest_name) = (f.owner.as_str(), f.guest.as_str());
    reset(&pool, &f).await;

    // The owner already exists (they own the folder being indexed); the guest does NOT - the resolver
    // has to create them from the embedded MB id alone.
    let owner_id = common::db::ensure_artist(&pool, owner_name)
        .await
        .expect("owner");

    let release_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
           VALUES ($1, 'Resolve Fixture', 2020, $2, $3, now(), now())"#,
    )
    .bind(&release_id)
    .bind(format!("folder:{}/{}", f.prefix, release_id))
    .bind(format!("{}/{}", f.prefix, release_id))
    .execute(&pool).await.expect("insert release");

    sqlx::query(
        r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
           VALUES ($1, $2, $3, now())"#,
    )
    .bind(cuid2::create_id())
    .bind(&release_id)
    .bind(&owner_id)
    .execute(&pool)
    .await
    .expect("insert release artist");

    // Picard-style tags: the compound display string, plus the already-split pair.
    let track_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalReleaseTrack"
             (id, title, artist, "albumArtist", album, "filePath", "localReleaseId", "playCount",
              artists, "mbArtistIds", "createdAt", "updatedAt")
           VALUES ($1, 'Fixture Track', $2, $3, 'Resolve Fixture', $4, $5, 0, $6, $7, now(), now())"#,
    )
    .bind(&track_id)
    .bind(format!("{} with {}", owner_name, guest_name))
    .bind(owner_name)
    .bind(format!("{}/{}/01.mp3", f.prefix, release_id))
    .bind(&release_id)
    .bind(vec![owner_name.to_string(), guest_name.to_string()])
    .bind(vec![OWNER_MBID.to_string(), GUEST_MBID.to_string()])
    .execute(&pool).await.expect("insert track");

    let mut resolver = ArtistResolver::new(&pool, false);
    // Any network call here is a bug: the file already answers the question.
    resolver.offline = true;
    let mut report: Vec<Decision> = Vec::new();
    resolve_and_apply(
        &pool,
        &mut resolver,
        Some(&[release_id.clone()]),
        &mut report,
        None,
    )
    .await
    .expect("resolution failed");

    assert_eq!(
        resolver.stats.mb_lookups, 0,
        "tier 0 must not touch the network"
    );

    // The guest now exists as an artist, carrying the MB id straight from the tag.
    let guest: Option<(String, Option<String>)> =
        sqlx::query_as(r#"SELECT id, "musicbrainzId" FROM "Artist" WHERE slug = $1"#)
            .bind(common::slug::make_slug(guest_name))
            .fetch_optional(&pool)
            .await
            .expect("guest query");
    let (guest_id, guest_mbid) = guest.expect("guest artist should have been created");
    assert_eq!(
        guest_mbid.as_deref(),
        Some(GUEST_MBID),
        "embedded MB id should be stored"
    );

    // ...credited on the track, but NOT an owner of the release.
    let credited: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM "TrackRelatedArtist" WHERE "trackId" = $1 AND "artistId" = $2)"#,
    )
    .bind(&track_id).bind(&guest_id)
    .fetch_one(&pool).await.expect("credit query");
    assert!(credited, "guest should be credited on the track");

    let owns: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM "LocalReleaseArtist" WHERE "localReleaseId" = $1 AND "artistId" = $2)"#,
    )
    .bind(&release_id).bind(&guest_id)
    .fetch_one(&pool).await.expect("owner query");
    assert!(!owns, "a guest must never become an owner of the release");

    // The release's own artist is never credited on its own track (no self-credit).
    let self_credited: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM "TrackRelatedArtist" WHERE "trackId" = $1 AND "artistId" = $2)"#,
    )
    .bind(&track_id).bind(&owner_id)
    .fetch_one(&pool).await.expect("self credit query");
    assert!(
        !self_credited,
        "the release owner must not be credited on their own track"
    );

    reset(&pool, &f).await;
}

/// Dry run must not touch the library (no artists, no links, no credits). It DOES populate the
/// lookup cache on purpose - that is derived data, and re-asking MusicBrainz for every name again on
/// the real run would cost hours.
#[tokio::test]
#[ignore]
async fn dry_run_writes_no_library_data() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect("set SMOKE_TEST_DATABASE_URL");
    let pool = common::db::create_pool(&db_url).await;
    let f = Fixture::new("dryrun");
    let (owner_name, guest_name) = (f.owner.as_str(), f.guest.as_str());
    reset(&pool, &f).await;

    let owner_id = common::db::ensure_artist(&pool, owner_name)
        .await
        .expect("owner");
    let release_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
           VALUES ($1, 'Resolve Fixture', 2020, $2, $3, now(), now())"#,
    )
    .bind(&release_id)
    .bind(format!("folder:{}/{}", f.prefix, release_id))
    .bind(format!("{}/{}", f.prefix, release_id))
    .execute(&pool).await.expect("insert release");
    sqlx::query(
        r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt")
           VALUES ($1, $2, $3, now())"#,
    )
    .bind(cuid2::create_id())
    .bind(&release_id)
    .bind(&owner_id)
    .execute(&pool)
    .await
    .expect("insert release artist");

    let track_id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "LocalReleaseTrack"
             (id, title, artist, "albumArtist", album, "filePath", "localReleaseId", "playCount",
              artists, "mbArtistIds", "createdAt", "updatedAt")
           VALUES ($1, 'Fixture Track', $2, $3, 'Resolve Fixture', $4, $5, 0, $6, $7, now(), now())"#,
    )
    .bind(&track_id)
    .bind(format!("{} with {}", owner_name, guest_name))
    .bind(owner_name)
    .bind(format!("{}/{}/01.mp3", f.prefix, release_id))
    .bind(&release_id)
    .bind(vec![owner_name.to_string(), guest_name.to_string()])
    .bind(vec![OWNER_MBID.to_string(), GUEST_MBID.to_string()])
    .execute(&pool).await.expect("insert track");

    let mut resolver = ArtistResolver::new(&pool, true); // dry run
    resolver.offline = true;
    let mut report: Vec<Decision> = Vec::new();
    resolve_and_apply(
        &pool,
        &mut resolver,
        Some(&[release_id.clone()]),
        &mut report,
        None,
    )
    .await
    .expect("dry run failed");

    let guest_exists: bool =
        sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM "Artist" WHERE slug = $1)"#)
            .bind(common::slug::make_slug(guest_name))
            .fetch_one(&pool)
            .await
            .expect("guest query");
    assert!(!guest_exists, "dry run must not create artists");

    let credits: i64 =
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM "TrackRelatedArtist" WHERE "trackId" = $1"#)
            .bind(&track_id)
            .fetch_one(&pool)
            .await
            .expect("credit count");
    assert_eq!(credits, 0, "dry run must not write credits");

    reset(&pool, &f).await;
}

/// A single embedded `(name, mbid)` pair is the strongest possible proof that the whole tag names ONE
/// artist - but only when that value *is* the tag. Measured on the real library: 3,307 of 3,308
/// single-pair tracks match their tag, and exactly one does not (tag "The B.B. King Blues Band",
/// embedded value "B.B. King" - Picard credited the person, not the band). Trusting that one would
/// replace the band with the person, so it must fall through instead.
#[tokio::test]
#[ignore]
async fn single_embedded_pair_is_trusted_only_when_it_is_the_whole_tag() {
    use common::mb::resolve::JoinKind;
    use index::resolve::embedded_pairing;

    // A band whose own name contains a separator: one value, one id, identical to the tag.
    let matching = embedded_pairing(
        "Kool & the Gang",
        &["Kool & the Gang".to_string()],
        &[OWNER_MBID.to_string()],
        JoinKind::Guest,
    );
    let parts = matching.expect("a single pair equal to the tag must be trusted");
    assert_eq!(parts.len(), 1);
    assert_eq!(parts[0].name, "Kool & the Gang");
    assert!(parts[0].verified);
    assert_eq!(parts[0].mbid.as_deref(), Some(OWNER_MBID));

    // Case/punctuation differences still count as the same string.
    assert!(embedded_pairing(
        "AC/DC",
        &["ac/dc".to_string()],
        &[OWNER_MBID.to_string()],
        JoinKind::Guest,
    )
    .is_some());

    // The real exception - the embedded value names only part of the tag.
    assert!(
        embedded_pairing(
            "The B.B. King Blues Band",
            &["B.B. King".to_string()],
            &[OWNER_MBID.to_string()],
            JoinKind::Guest,
        )
        .is_none(),
        "a single pair that is NOT the whole tag must fall through to the lookup path"
    );

    // Mismatched lengths remain untrusted.
    assert!(embedded_pairing(
        "A & B",
        &["A".to_string(), "B".to_string()],
        &[OWNER_MBID.to_string()],
        JoinKind::Guest,
    )
    .is_none());
    assert!(embedded_pairing("A", &[], &[], JoinKind::Guest).is_none());
}

/// The pin: a name already answered in `MbArtistLookup` must cost nothing on the next run.
///
/// This is what makes a crashed `--resolve-artists` cheap to restart - the pass has no checkpoint, so
/// the cache IS the resume state. It also proves `--overwrite` still works: skipping the cache warm is
/// the whole mechanism by which a forced re-ask happens.
#[tokio::test]
#[ignore]
async fn a_cached_name_is_pinned_and_costs_no_lookups() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect("set SMOKE_TEST_DATABASE_URL");
    let pool = common::db::create_pool(&db_url).await;
    let name = "DMP Test Pinned Artist (resolve_artists)";

    sqlx::query(r#"DELETE FROM "MbArtistLookup" WHERE name = $1"#)
        .bind(name)
        .execute(&pool)
        .await
        .expect("clear lookup");
    sqlx::query(
        r#"INSERT INTO "MbArtistLookup" (id, name, normalized, mbid, "mbName", "checkedAt")
           VALUES ($1, $2, $3, $4, $2, NOW())"#,
    )
    .bind(cuid2::create_id())
    .bind(name)
    .bind(name.to_lowercase())
    .bind(OWNER_MBID)
    .execute(&pool)
    .await
    .expect("seed lookup");

    let names = vec![name.to_string()];

    let mut warm = ArtistResolver::new(&pool, true);
    warm.offline = true; // any network call here would be the bug this test exists to catch
    warm.warm_cache().await;
    assert!(warm.is_cached(name), "a cached answer must pin the name");
    warm.prefetch(&names, None).await;
    assert_eq!(
        warm.stats.mb_lookups, 0,
        "a pinned name must not be asked again"
    );
    // The discriminating assertion: `offline` alone would also yield 0 lookups, but it would yield a
    // deferral. Resolving from cache is the only way to get neither.
    assert_eq!(
        warm.stats.deferred, 0,
        "a pinned name must resolve from cache, not defer"
    );

    // --overwrite skips the warm, so nothing is pinned and the name is re-asked.
    let cold = ArtistResolver::new(&pool, true);
    assert!(
        !cold.is_cached(name),
        "without the cache warm nothing is pinned - this is how --overwrite forces a re-ask"
    );

    sqlx::query(r#"DELETE FROM "MbArtistLookup" WHERE name = $1"#)
        .bind(name)
        .execute(&pool)
        .await
        .expect("cleanup lookup");
}
