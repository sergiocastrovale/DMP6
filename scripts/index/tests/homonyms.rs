//! Two artists, one name, through the index resolve pass (`common::homonyms`): a release belongs to the artist its
//! files' ids name, whatever other artist already has the name, and the end state does not depend on the order
//! releases are indexed in.
//!
//! `#[ignore]`d integration test - point it at a disposable, migrated Postgres, never production:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p index --test homonyms -- --ignored

use std::collections::BTreeMap;

use index::resolve::{resolve_and_apply, ArtistResolver, Decision};
use sqlx::PgPool;

/// A per-test MusicBrainz id, so parallel tests never share a stub entry.
fn mbid(seed: &str) -> String {
    let h = seed.bytes().fold(0xcbf29ce484222325u128, |h, b| (h ^ b as u128).wrapping_mul(0x100000001b3));
    let hex = format!("{h:032x}");
    format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

struct Ctx {
    pool: PgPool,
    name: String,
    folder: String,
    pt: String,
    kr: String,
}

impl Ctx {
    async fn new() -> Self {
        let db_url = std::env::var("SMOKE_TEST_DATABASE_URL")
            .expect("set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres");
        let tag = cuid2::create_id()[..8].to_string();
        let name = format!("Napa {tag}");
        let (pt, kr) = (mbid(&format!("pt{tag}")), mbid(&format!("kr{tag}")));
        // One stub MusicBrainz for the whole binary (its base URL is read once per process); this test's artists are
        // registered under their own ids, so a file id for a shared name is confirmed without the network.
        std::env::set_var("MB_BASE_URL", common::testing::shared_url());
        std::env::set_var("MB_MIN_DELAY_MS", "0");
        common::testing::shared_add_artist(&pt, &name, Some("PT"), &["Senso Comum", "Logo Se Ve"]);
        common::testing::shared_add_artist(&kr, &name, Some("KR"), &[]);
        Self {
            pool: common::db::create_pool(&db_url, "test").await.expect("connect"),
            name,
            folder: format!("homonyms-{tag}"),
            pt,
            kr,
        }
    }

    fn base(&self) -> String {
        common::slug::make_slug(&self.name)
    }

    /// The name is one MusicBrainz knows several artists by, as the resolver records it.
    async fn mark_ambiguous(&self) {
        sqlx::query(
            r#"INSERT INTO "MbArtistLookup" (id, name, normalized, mbid, ambiguous, "checkedAt")
               VALUES ($1, $2, $3, NULL, true, NOW())"#,
        )
        .bind(cuid2::create_id())
        .bind(&self.name)
        .bind(common::mb::names::normalize_name(&self.name))
        .execute(&self.pool)
        .await
        .unwrap();
    }

    /// A release in the shared folder, with one track whose album-artist pairing carries `mbid` (or nothing).
    async fn release(&self, title: &str, mbid: Option<&str>) -> String {
        let id = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "LocalRelease" (id, title, year, "groupKey", "folderPath", "createdAt", "updatedAt")
               VALUES ($1, $2, 2020, $3, $4, now(), now())"#,
        )
        .bind(&id)
        .bind(title)
        .bind(format!("folder:{}/{}", self.folder, title))
        .bind(format!("{}/{}", self.folder, title))
        .execute(&self.pool)
        .await
        .unwrap();
        // The shape of 99.8% of the live library: an album-artist id with no ALBUMARTISTS frame beside it.
        let names: Vec<String> = Vec::new();
        let ids: Vec<String> = mbid.map(|m| vec![m.to_string()]).unwrap_or_default();
        sqlx::query(
            r#"INSERT INTO "LocalReleaseTrack"
                 (id, title, artist, "albumArtist", album, "filePath", "localReleaseId",
                  "albumArtists", "mbAlbumArtistIds", "createdAt", "updatedAt")
               VALUES ($1, 'T', $2, $2, $3, $4, $5, $6, $7, now(), now())"#,
        )
        .bind(cuid2::create_id())
        .bind(&self.name)
        .bind(title)
        .bind(format!("{}/{}/01.mp3", self.folder, title))
        .bind(&id)
        .bind(&names)
        .bind(&ids)
        .execute(&self.pool)
        .await
        .unwrap();
        id
    }

    /// What the folder scan used to leave behind: one row for the name, owning everything.
    async fn premerged_owner(&self, mbid: &str, releases: &[&String]) {
        let artist = cuid2::create_id();
        sqlx::query(
            r#"INSERT INTO "Artist" (id, name, slug, "musicbrainzId", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, 0, 0, now() - interval '2 days', now())"#,
        )
        .bind(&artist)
        .bind(&self.name)
        .bind(self.base())
        .bind(mbid)
        .execute(&self.pool)
        .await
        .unwrap();
        for r in releases {
            sqlx::query(r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt") VALUES ($1, $2, $3, now())"#)
                .bind(cuid2::create_id())
                .bind(r.as_str())
                .bind(&artist)
                .execute(&self.pool)
                .await
                .unwrap();
        }
    }

    async fn run(&self, releases: &[String]) {
        let mut resolver = ArtistResolver::new(&self.pool, false);
        resolver.warm_cache().await;
        let mut report: Vec<Decision> = Vec::new();
        resolve_and_apply(&self.pool, &mut resolver, Some(releases), &mut report, None).await.expect("resolve");
    }

    /// release title -> (owner's MB id or "unidentified", owner's slug)
    async fn state(&self) -> BTreeMap<String, (String, String)> {
        let rows: Vec<(String, Option<String>, String)> = sqlx::query_as(
            r#"SELECT lr.title, COALESCE(p."musicbrainzId", a."musicbrainzId"), COALESCE(p.slug, a.slug)
               FROM "LocalRelease" lr
               JOIN "LocalReleaseArtist" l ON l."localReleaseId" = lr.id
               JOIN "Artist" a ON a.id = l."artistId"
               LEFT JOIN "Artist" p ON p.id = a."primaryArtistId"
               WHERE lr."folderPath" LIKE $1"#,
        )
        .bind(format!("{}/%", self.folder))
        .fetch_all(&self.pool)
        .await
        .unwrap();
        rows.into_iter()
            .map(|(t, m, s)| (t, (m.unwrap_or_else(|| "unidentified".into()), s)))
            .collect()
    }

    async fn violations(&self) -> Vec<(String, String)> {
        common::homonyms::violations(&self.pool)
            .await
            .unwrap()
            .into_iter()
            .filter(|(b, _)| *b == self.base())
            .collect()
    }
}

#[tokio::test]
#[ignore]
async fn a_premerged_artist_splits_by_the_ids_its_files_carry() {
    let c = Ctx::new().await;
    c.mark_ambiguous().await;
    let senso = c.release("Senso Comum", Some(c.pt.as_str())).await;
    let logo = c.release("Logo Se Ve", Some(c.pt.as_str())).await;
    let eleven = c.release("11-11", Some(c.kr.as_str())).await;
    let untagged = c.release("Untagged", None).await;
    c.premerged_owner(&c.pt.clone(), &[&senso, &logo, &eleven, &untagged]).await;

    c.run(&[senso, logo, eleven, untagged]).await;

    let s = c.state().await;
    let base = c.base();
    assert_eq!(s["Senso Comum"], (c.pt.clone(), format!("{base}-{}", &c.pt[..8])));
    assert_eq!(s["Logo Se Ve"], (c.pt.clone(), format!("{base}-{}", &c.pt[..8])));
    assert_eq!(s["11-11"], (c.kr.clone(), format!("{base}-{}", &c.kr[..8])));
    assert_eq!(s["Untagged"].0, "unidentified", "no id and no evidence: never the PT artist by guess");
    assert!(s["Untagged"].1.starts_with(&format!("{base}-")));
    assert!(c.violations().await.is_empty());

    let redirect: Option<String> = sqlx::query_scalar(r#"SELECT "oldSlug" FROM "ArtistSlugHistory" WHERE "oldSlug" = $1"#)
        .bind(&base)
        .fetch_optional(&c.pool)
        .await
        .unwrap();
    assert!(redirect.is_none(), "the bare slug of a group is the chooser's");
}

#[tokio::test]
#[ignore]
async fn the_order_releases_are_indexed_in_does_not_change_the_result() {
    // Same library, indexed all at once and one release at a time in a different order, then once more.
    let mut results = Vec::new();
    for order in [[0usize, 1, 2, 3], [2, 3, 0, 1]] {
        let c = Ctx::new().await;
        c.mark_ambiguous().await;
        let ids = vec![
            c.release("Senso Comum", Some(c.pt.as_str())).await,
            c.release("Logo Se Ve", Some(c.pt.as_str())).await,
            c.release("11-11", Some(c.kr.as_str())).await,
            c.release("Untagged", None).await,
        ];
        for &i in &order {
            c.run(std::slice::from_ref(&ids[i])).await;
        }
        c.run(&ids).await;
        assert!(c.violations().await.is_empty());
        let base = c.base();
        let shape: BTreeMap<String, (String, String)> = c
            .state()
            .await
            .into_iter()
            .map(|(t, (m, s))| {
                // Each run has its own ids; compare by role.
                let role = |id: &str| if id == c.pt { "PT".to_string() } else if id == c.kr { "KR".to_string() } else { id.to_string() };
                let suffix = s.strip_prefix(&format!("{base}-")).unwrap_or("BARE").to_string();
                let suffix = if m == "unidentified" {
                    "artist-id".to_string()
                } else if suffix == c.pt[..8] {
                    "PT8".to_string()
                } else if suffix == c.kr[..8] {
                    "KR8".to_string()
                } else {
                    suffix
                };
                (t, (role(&m), suffix))
            })
            .collect();
        results.push(shape);
    }
    assert_eq!(results[0], results[1]);
}

#[tokio::test]
#[ignore]
async fn a_lone_artist_keeps_its_bare_slug_and_takes_its_untagged_releases() {
    let c = Ctx::new().await;
    let tagged = c.release("Senso Comum", Some(c.pt.as_str())).await;
    let untagged = c.release("Untagged", None).await;
    c.premerged_owner(&c.pt.clone(), &[&tagged, &untagged]).await;
    c.run(&[tagged, untagged]).await;
    let s = c.state().await;
    assert_eq!(s["Senso Comum"].1, c.base());
    assert_eq!(s["Untagged"].1, c.base(), "one artist by this name, so it is theirs as before");
}
