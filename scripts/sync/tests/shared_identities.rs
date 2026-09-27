//! Tidy's identity Pass C (`db::repair_shared_identities`) against a real Postgres. `#[ignore]`d; `scripts/test-db` runs it.
//!
//! Two rows holding one MusicBrainz id keep it only on a member the name cache confirms. A name several MusicBrainz
//! artists share is never confirmed by the cache - it holds no one id for it - so the pass must leave such a group to the
//! homonym rules instead of stripping every member (docs/sync_decisions.md §21; on the live library it wiped the id off
//! "Ben Webster").

use sqlx::PgPool;

async fn pool() -> PgPool {
    let url = std::env::var("SMOKE_TEST_DATABASE_URL").expect("set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres");
    PgPool::connect(&url).await.expect("connect")
}

async fn artist(pool: &PgPool, name: &str, mbid: &str) -> String {
    let id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "Artist" (id, name, slug, "musicbrainzId", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 0, 0, now(), now())"#,
    )
    .bind(&id)
    .bind(name)
    .bind(format!("{}-{}", common::slug::make_slug(name), &id[..6]))
    .bind(mbid)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn mbid_of(pool: &PgPool, id: &str) -> Option<String> {
    sqlx::query_scalar(r#"SELECT "musicbrainzId" FROM "Artist" WHERE id = $1"#).bind(id).fetch_one(pool).await.unwrap()
}

#[tokio::test]
#[ignore]
async fn a_shared_id_under_an_ambiguous_name_is_left_alone() {
    let pool = pool().await;
    let tag = &cuid2::create_id()[..6];
    let name = format!("Ben Webster {tag}");
    let id = format!("e28c0b26-3bdb-45dc-b4f5-{tag}000000");
    let a = artist(&pool, &name, &id).await;
    let b = artist(&pool, &format!("{name} meets Don Byas"), &id).await;
    sqlx::query(r#"INSERT INTO "MbArtistLookup" (id, name, normalized, mbid, ambiguous, "checkedAt") VALUES ($1, $2, $3, NULL, true, now())"#)
        .bind(cuid2::create_id())
        .bind(&name)
        .bind(common::mb::names::normalize_name(&name))
        .execute(&pool)
        .await
        .unwrap();

    dmp_sync::db::repair_shared_identities(&pool, false).await.unwrap();

    assert_eq!(mbid_of(&pool, &a).await.as_deref(), Some(id.as_str()));
    assert_eq!(mbid_of(&pool, &b).await.as_deref(), Some(id.as_str()));
}

#[tokio::test]
#[ignore]
async fn an_unconfirmed_shared_id_is_still_cleared_when_no_name_is_ambiguous() {
    let pool = pool().await;
    let tag = &cuid2::create_id()[..6];
    let id = format!("0480ca1e-6fe0-42e7-893b-{tag}000000");
    let a = artist(&pool, &format!("T-SQUARE {tag}"), &id).await;
    let b = artist(&pool, &format!("THE SQUARE {tag}"), &id).await;

    dmp_sync::db::repair_shared_identities(&pool, false).await.unwrap();

    assert_eq!(mbid_of(&pool, &a).await, None, "the existing rule, unchanged");
    assert_eq!(mbid_of(&pool, &b).await, None);
}
