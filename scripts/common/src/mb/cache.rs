//! Read access to the `MbArtistLookup` table for consumers other than the index resolver that fills it.
//!
//! The resolver (`index/src/resolve.rs`) owns this table: it writes every answer it gets from
//! MusicBrainz, hits and misses alike. Sync asks MusicBrainz many of the same questions - 9,507 artists
//! carry no `musicbrainzId` and fall into `find_mb_match_with_fallback`'s search ladder - and paid for
//! them again every run, because nothing outside `index` had ever read this table.
//!
//! # Hits only, and never written back
//!
//! The two binaries ask different questions with different matchers, and the asymmetry is the whole
//! reason this module is read-only:
//!
//! * the resolver uses `mb_search_artist_exact` - strict, alias-aware, "is this string *the* artist?"
//! * sync uses `mb_search_artist` - fuzzy, `score >= 90 && names_are_similar`
//!
//! An exact hit is strictly stronger than a fuzzy one, so sync may take it and skip the request. A
//! cached **miss** only says the strict search found nothing; sync's fuzzy search might still match, so
//! a miss must fall through rather than short-circuit - hence every function here returns hits only.
//!
//! And nothing outside the resolver may *write* here. `common::mb::api`'s note on `mb_search_artist`
//! spells out the hazard: `names_are_similar` scores "Frank Sinatra with Count Basie" against "Frank
//! Sinatra" at exactly 0.5 and passes, so feeding fuzzy results back would confirm nearly every
//! compound tag as a single artist and corrupt the resolver's decisions for every later run.

use std::collections::HashMap;

use sqlx::PgPool;

use super::types::MbArtistMatch;

/// Shape a cached exact lookup into the match type the callers already handle.
///
/// `mbName` is NULL on every row written before it was populated, so it falls back to the string that
/// was queried - the same shim sync already applies when an `Artist` row has a known `musicbrainzId`.
/// `score` is 100 because an exact match is exactly that; there is no ranking left to do.
pub fn match_from_cache_row(
    queried: &str,
    mbid: String,
    mb_name: Option<String>,
) -> MbArtistMatch {
    MbArtistMatch {
        id: mbid,
        name: mb_name.unwrap_or_else(|| queried.to_string()),
        score: Some(100),
        aliases: None,
    }
}

/// One cached exact **hit**, or `None`. Cached misses deliberately return `None` too - see the module
/// note; the caller must go on to run its own search.
pub async fn cached_exact_artist(pool: &PgPool, name: &str) -> Option<MbArtistMatch> {
    let row: Option<(Option<String>, Option<String>)> =
        sqlx::query_as(r#"SELECT mbid, "mbName" FROM "MbArtistLookup" WHERE name = $1"#)
            .bind(name)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    let (mbid, mb_name) = row?;
    Some(match_from_cache_row(name, mbid?, mb_name))
}

/// Bulk form for names known before the work starts, so a run does one query instead of one per name.
/// Mirrors the resolver's own `warm_cache`. Misses are omitted from the map, not recorded as absent.
pub async fn warm_exact_artists(
    pool: &PgPool,
    names: &[String],
) -> HashMap<String, MbArtistMatch> {
    if names.is_empty() {
        return HashMap::new();
    }
    let rows: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT name, mbid, "mbName" FROM "MbArtistLookup"
           WHERE name = ANY($1::text[]) AND mbid IS NOT NULL"#,
    )
    .bind(names)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .filter_map(|(name, mbid, mb_name)| {
            let m = match_from_cache_row(&name, mbid?, mb_name);
            Some((name, m))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cached_row_carries_mb_spelling_when_it_has_one() {
        let m = match_from_cache_row(
            "sonny rollins",
            "abc-123".to_string(),
            Some("Sonny Rollins".to_string()),
        );
        assert_eq!(m.id, "abc-123");
        assert_eq!(m.name, "Sonny Rollins", "MB's spelling wins over the tag's");
        assert_eq!(m.score, Some(100));
        assert!(m.aliases.is_none());
    }

    #[test]
    fn a_row_without_mb_name_falls_back_to_the_queried_string() {
        // Every row written before `mbName` was populated looks like this, and there are thousands of
        // them - the fallback is the normal case, not an edge case.
        let m = match_from_cache_row("Sonny Rollins", "abc-123".to_string(), None);
        assert_eq!(m.name, "Sonny Rollins");
        assert_eq!(m.score, Some(100));
    }

    // --- DB-backed, #[ignore]d like the other integration tests -------------------------------------
    //
    //   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p common --test-threads=1 \
    //     -- --ignored --nocapture
    //
    // Point it at a disposable, migrated database - never the production DATABASE_URL.

    const HIT_NAME: &str = "DMP Test Cache Hit (common::mb::cache)";
    const MISS_NAME: &str = "DMP Test Cache Miss (common::mb::cache)";
    const FIXTURE_MBID: &str = "33333333-3333-4333-8333-333333333333";

    async fn seed(pool: &PgPool, name: &str, mbid: Option<&str>) {
        sqlx::query(r#"DELETE FROM "MbArtistLookup" WHERE name = $1"#)
            .bind(name)
            .execute(pool)
            .await
            .expect("clear");
        sqlx::query(
            r#"INSERT INTO "MbArtistLookup" (id, name, normalized, mbid, "mbName", "checkedAt")
               VALUES ($1, $2, $3, $4, NULL, NOW())"#,
        )
        .bind(cuid2::create_id())
        .bind(name)
        .bind(name.to_lowercase())
        .bind(mbid)
        .execute(pool)
        .await
        .expect("seed");
    }

    #[tokio::test]
    #[ignore]
    async fn a_cached_hit_is_returned_and_a_cached_miss_is_not() {
        let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
            "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres - this test never runs \
             against the production DATABASE_URL",
        );
        let pool = crate::db::create_pool(&db_url).await;
        seed(&pool, HIT_NAME, Some(FIXTURE_MBID)).await;
        seed(&pool, MISS_NAME, None).await;

        let hit = cached_exact_artist(&pool, HIT_NAME).await;
        assert_eq!(hit.map(|m| m.id).as_deref(), Some(FIXTURE_MBID));

        // The rule the whole module exists to enforce: a cached miss must NOT short-circuit the
        // caller's own (fuzzy) search, so it is indistinguishable from "not cached".
        assert!(cached_exact_artist(&pool, MISS_NAME).await.is_none());
        assert!(cached_exact_artist(&pool, "DMP Test Never Seen").await.is_none());

        let warmed = warm_exact_artists(
            &pool,
            &[
                HIT_NAME.to_string(),
                MISS_NAME.to_string(),
                "DMP Test Never Seen".to_string(),
            ],
        )
        .await;
        assert_eq!(warmed.len(), 1, "only the hit belongs in the warmed map");
        assert_eq!(warmed[HIT_NAME].id, FIXTURE_MBID);
        assert_eq!(
            warmed[HIT_NAME].name, HIT_NAME,
            "NULL mbName falls back to the queried string"
        );

        for n in [HIT_NAME, MISS_NAME] {
            sqlx::query(r#"DELETE FROM "MbArtistLookup" WHERE name = $1"#)
                .bind(n)
                .execute(&pool)
                .await
                .ok();
        }
    }
}
