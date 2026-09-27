//! The homonym rules (`common::homonyms`) against a real Postgres (`#[ignore]`d; `scripts/test-db` runs it).
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p common --test homonyms -- --ignored
//!
//! Every test works on its own randomly-named base slug, so the tests can share one database and run in parallel.

use common::homonyms::{
    ensure_artist_identity, reconcile_group, reconcile_touched, violations, IdSource, IdentityRequest, IdentityState,
};
use common::slug::make_slug;
use sqlx::PgPool;

async fn pool() -> PgPool {
    let url = std::env::var("SMOKE_TEST_DATABASE_URL")
        .expect("set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres");
    PgPool::connect(&url).await.expect("connect")
}

fn name() -> String {
    format!("Napa {}", &cuid2::create_id()[..8])
}

const PT: &str = "d76eeba7-d35c-4fe8-bffa-ce2885c97765";
const KR: &str = "9f3423ee-debe-48ec-b78d-281438aaf626";

fn owner<'a>(name: &'a str, mbid: Option<&'a str>, source: IdSource, title: Option<&'a str>) -> IdentityRequest<'a> {
    IdentityRequest { name, mbid, source, release_title: title, credit: false }
}

async fn slug_of(pool: &PgPool, id: &str) -> String {
    sqlx::query_scalar(r#"SELECT slug FROM "Artist" WHERE id = $1"#).bind(id).fetch_one(pool).await.unwrap()
}

async fn own_release(pool: &PgPool, artist_id: &str, title: &str) -> String {
    let release = cuid2::create_id();
    sqlx::query(r#"INSERT INTO "LocalRelease" (id, title, "groupKey", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())"#)
        .bind(&release)
        .bind(title)
        .bind(format!("folder:homonyms/{release}"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt") VALUES ($1, $2, $3, NOW())"#)
        .bind(cuid2::create_id())
        .bind(&release)
        .bind(artist_id)
        .execute(pool)
        .await
        .unwrap();
    release
}

async fn catalogue(pool: &PgPool, artist_id: &str, title: &str) {
    let type_id: String = sqlx::query_scalar(
        r#"INSERT INTO "ReleaseType" (id, name, slug, "createdAt", "updatedAt")
           VALUES ('release-type-album', 'Album', 'album', now(), now())
           ON CONFLICT (name) DO UPDATE SET "updatedAt" = now()
           RETURNING id"#,
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let mb = cuid2::create_id();
    sqlx::query(r#"INSERT INTO "MusicBrainzRelease" (id, title, "typeId", "musicbrainzId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, NOW(), NOW())"#)
        .bind(&mb)
        .bind(title)
        .bind(&type_id)
        .bind(uuid_like())
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(r#"INSERT INTO "MusicBrainzReleaseArtist" (id, "releaseId", "artistId", "createdAt") VALUES ($1, $2, $3, NOW())"#)
        .bind(cuid2::create_id())
        .bind(&mb)
        .bind(artist_id)
        .execute(pool)
        .await
        .unwrap();
}

fn uuid_like() -> String {
    let h = cuid2::create_id();
    format!("{}-{}", &h[..8], &h[8..20])
}

async fn group_violations(pool: &PgPool, base: &str) -> Vec<String> {
    violations(pool).await.unwrap().into_iter().filter(|(b, _)| b == base).map(|(_, r)| r).collect()
}

#[tokio::test]
#[ignore]
async fn two_proven_ids_under_one_name_become_two_suffixed_artists() {
    let pool = pool().await;
    let n = name();
    let base = make_slug(&n);
    let mut state = IdentityState::new();

    let pt = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(PT), IdSource::Proven, None)).await.unwrap();
    own_release(&pool, &pt, "Senso Comum").await;
    reconcile_touched(&pool, &mut state).await.unwrap();
    assert_eq!(slug_of(&pool, &pt).await, base, "alone, it keeps the bare slug");

    let kr = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(KR), IdSource::Proven, None)).await.unwrap();
    own_release(&pool, &kr, "11:11").await;
    let outcome = reconcile_touched(&pool, &mut state).await.unwrap();

    assert_ne!(pt, kr);
    assert_eq!(slug_of(&pool, &pt).await, format!("{base}-d76eeba7"));
    assert_eq!(slug_of(&pool, &kr).await, format!("{base}-9f3423ee"));
    assert!(outcome.renamed.iter().any(|(id, old, _)| id == &pt && old == &base));
    let redirect: String = sqlx::query_scalar(r#"SELECT "artistId" FROM "ArtistSlugHistory" WHERE "oldSlug" = $1"#)
        .bind(&base)
        .fetch_optional(&pool)
        .await
        .unwrap()
        .unwrap_or_default();
    assert_eq!(redirect, "", "the bare slug of a group is the chooser's, never a redirect");
    assert!(group_violations(&pool, &base).await.is_empty());
}

#[tokio::test]
#[ignore]
async fn a_release_without_an_id_goes_by_catalogue_evidence_else_to_the_unidentified_member() {
    let pool = pool().await;
    let n = name();
    let base = make_slug(&n);
    let mut state = IdentityState::new();
    let pt = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(PT), IdSource::Proven, None)).await.unwrap();
    let kr = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(KR), IdSource::Proven, None)).await.unwrap();
    own_release(&pool, &pt, "Senso Comum").await;
    own_release(&pool, &kr, "11:11").await;
    catalogue(&pool, &pt, "Logo Se Vê").await;
    reconcile_touched(&pool, &mut state).await.unwrap();

    let by_evidence = ensure_artist_identity(&pool, &mut state, &owner(&n, None, IdSource::Search, Some("logo se ve"))).await.unwrap();
    assert_eq!(by_evidence, pt, "its title is in exactly one member's catalogue");

    let unknown = ensure_artist_identity(&pool, &mut state, &owner(&n, None, IdSource::Search, Some("Something Else"))).await.unwrap();
    assert!(unknown != pt && unknown != kr, "no evidence: never an identified member by guess");
    own_release(&pool, &unknown, "Something Else").await;
    let again = ensure_artist_identity(&pool, &mut state, &owner(&n, None, IdSource::Search, Some("Another One"))).await.unwrap();
    assert_eq!(again, unknown, "one unidentified member per group");
    reconcile_touched(&pool, &mut state).await.unwrap();

    let slug = slug_of(&pool, &unknown).await;
    assert!(slug.starts_with(&format!("{base}-")) && slug != base);
    assert!(group_violations(&pool, &base).await.is_empty());
}

#[tokio::test]
#[ignore]
async fn a_credit_without_an_id_is_dropped_in_a_group_and_kept_for_a_lone_artist() {
    let pool = pool().await;
    let n = name();
    let mut state = IdentityState::new();
    let pt = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(PT), IdSource::Proven, None)).await.unwrap();
    let credit = IdentityRequest { name: &n, mbid: None, source: IdSource::Search, release_title: None, credit: true };
    assert_eq!(ensure_artist_identity(&pool, &mut state, &credit).await.unwrap(), pt);

    ensure_artist_identity(&pool, &mut state, &owner(&n, Some(KR), IdSource::Proven, None)).await.unwrap();
    reconcile_touched(&pool, &mut state).await.unwrap();
    assert_eq!(ensure_artist_identity(&pool, &mut state, &credit).await.unwrap(), "");
}

#[tokio::test]
#[ignore]
async fn a_search_id_fills_the_lone_artist_but_never_creates_a_homonym() {
    let pool = pool().await;
    let n = name();
    let base = make_slug(&n);
    let mut state = IdentityState::new();
    let lone = ensure_artist_identity(&pool, &mut state, &owner(&n, None, IdSource::Search, None)).await.unwrap();
    let filled = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(PT), IdSource::Search, None)).await.unwrap();
    assert_eq!(filled, lone);
    let stored: Option<String> = sqlx::query_scalar(r#"SELECT "musicbrainzId" FROM "Artist" WHERE id = $1"#).bind(&lone).fetch_one(&pool).await.unwrap();
    assert_eq!(stored.as_deref(), Some(PT));

    let kr_group = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(KR), IdSource::Proven, None)).await.unwrap();
    reconcile_touched(&pool, &mut state).await.unwrap();
    let guess = ensure_artist_identity(&pool, &mut state, &owner(&n, Some("11111111-2222-3333-4444-555555555555"), IdSource::Search, Some("X"))).await.unwrap();
    assert!(guess != lone && guess != kr_group, "a searched id is not trusted once the name is shared");
    reconcile_touched(&pool, &mut state).await.unwrap();
    let members: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Artist" WHERE "baseSlug" = $1 AND "primaryArtistId" IS NULL"#)
        .bind(&base)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(members, 3, "PT, KR and the unidentified member - no fourth row from the searched id");
}

#[tokio::test]
#[ignore]
async fn a_proven_id_identifies_a_lone_unidentified_artist_instead_of_splitting_it() {
    let pool = pool().await;
    let n = name();
    let base = make_slug(&n);
    let mut state = IdentityState::new();
    let lone = ensure_artist_identity(&pool, &mut state, &owner(&n, None, IdSource::Search, None)).await.unwrap();
    own_release(&pool, &lone, "Untagged").await;
    let tagged = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(PT), IdSource::Proven, None)).await.unwrap();
    assert_eq!(tagged, lone, "the name's only artist, not yet identified, is this one");
    reconcile_touched(&pool, &mut state).await.unwrap();
    assert_eq!(slug_of(&pool, &lone).await, base);
}

#[tokio::test]
#[ignore]
async fn the_group_shrinks_back_to_the_bare_slug_and_old_links_redirect() {
    let pool = pool().await;
    let n = name();
    let base = make_slug(&n);
    let mut state = IdentityState::new();
    let pt = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(PT), IdSource::Proven, None)).await.unwrap();
    let kr = ensure_artist_identity(&pool, &mut state, &owner(&n, Some(KR), IdSource::Proven, None)).await.unwrap();
    own_release(&pool, &pt, "Senso Comum").await;
    own_release(&pool, &kr, "11:11").await;
    reconcile_touched(&pool, &mut state).await.unwrap();

    sqlx::query(r#"DELETE FROM "Artist" WHERE id = $1"#).bind(&kr).execute(&pool).await.unwrap();
    reconcile_group(&pool, &base).await.unwrap();
    assert_eq!(slug_of(&pool, &pt).await, base);
    let redirect: String = sqlx::query_scalar(r#"SELECT "artistId" FROM "ArtistSlugHistory" WHERE "oldSlug" = $1"#)
        .bind(format!("{base}-d76eeba7"))
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(redirect, pt);
    assert!(group_violations(&pool, &base).await.is_empty());
}

#[tokio::test]
#[ignore]
async fn pre_existing_duplicates_are_connected_not_deleted_and_reconcile_is_idempotent() {
    let pool = pool().await;
    let n = name();
    let base = make_slug(&n);
    // Two rows with one MB id and two with none, written the way data from before this change can look.
    let mut ids = Vec::new();
    for (i, mbid) in [Some(PT), Some(PT), None, None].into_iter().enumerate() {
        let id = cuid2::create_id();
        sqlx::query(r#"INSERT INTO "Artist" (id, name, slug, "baseSlug", "musicbrainzId", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
                       VALUES ($1, $2, $3, $4, $5, 0, 0, NOW(), NOW())"#)
            .bind(&id)
            .bind(&n)
            .bind(if i == 0 { base.clone() } else { format!("{base}-legacy{i}") })
            .bind(&base)
            .bind(mbid)
            .execute(&pool)
            .await
            .unwrap();
        ids.push(id);
    }
    own_release(&pool, &ids[1], "A").await;
    own_release(&pool, &ids[1], "B").await;
    own_release(&pool, &ids[2], "C").await;

    let first = reconcile_group(&pool, &base).await.unwrap();
    assert_eq!(first.connected.len(), 2);
    let second = reconcile_group(&pool, &base).await.unwrap();
    assert!(second.is_empty(), "a group in shape changes nothing");
    let rows: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Artist" WHERE "baseSlug" = $1"#).bind(&base).fetch_one(&pool).await.unwrap();
    assert_eq!(rows, 4, "nothing deleted");
    assert!(group_violations(&pool, &base).await.is_empty());
}

#[tokio::test]
#[ignore]
async fn ensure_artist_by_bare_name_lands_on_the_unidentified_member_of_a_group() {
    let pool = pool().await;
    let n = name();
    let base = make_slug(&n);
    let mut state = IdentityState::new();
    ensure_artist_identity(&pool, &mut state, &owner(&n, Some(PT), IdSource::Proven, None)).await.unwrap();
    ensure_artist_identity(&pool, &mut state, &owner(&n, Some(KR), IdSource::Proven, None)).await.unwrap();
    reconcile_touched(&pool, &mut state).await.unwrap();

    let id = common::db::ensure_artist(&pool, &n).await.unwrap();
    let mbid: Option<String> = sqlx::query_scalar(r#"SELECT "musicbrainzId" FROM "Artist" WHERE id = $1"#).bind(&id).fetch_one(&pool).await.unwrap();
    assert!(mbid.is_none());
    assert_ne!(slug_of(&pool, &id).await, base);
    assert!(group_violations(&pool, &base).await.is_empty());
}
