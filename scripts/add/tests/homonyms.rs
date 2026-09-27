//! `./add` when the library already has an artist with the same name - the real binary, against a disposable
//! Postgres and a stub MusicBrainz. `#[ignore]`d; `scripts/test-db` runs it:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p add --test homonyms -- --ignored
//!
//! Safety: the binary is started from an empty temp directory with DATABASE_URL set explicitly, so it cannot find
//! web/.env (whose DATABASE_URL is production) - dotenvy never overrides a variable that is already set.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use sqlx::PgPool;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// A MusicBrainz stand-in: artist details, exact-name search, and release-group browses, from fixed data.
#[derive(Clone, Default)]
struct Mb {
    /// id -> (name, country)
    artists: HashMap<String, (String, Option<String>)>,
    /// id -> release-group titles
    groups: HashMap<String, Vec<String>>,
}

impl Mb {
    fn respond(&self, target: &str) -> String {
        let path = target.split('?').next().unwrap_or("");
        let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
        if path.ends_with("/artist/") {
            let artists: Vec<serde_json::Value> = self
                .artists
                .iter()
                .map(|(id, (name, _))| serde_json::json!({ "id": id, "name": name, "score": 100 }))
                .collect();
            return serde_json::json!({ "artists": artists, "count": artists.len() }).to_string();
        }
        if let Some(id) = path.strip_prefix("/ws/2/artist/") {
            if let Some((name, country)) = self.artists.get(id) {
                let area = country.as_ref().map(|c| serde_json::json!({ "iso-3166-1-codes": [c] }));
                return serde_json::json!({ "id": id, "name": name, "area": area, "relations": [], "genres": [], "tags": [] }).to_string();
            }
        }
        if path.ends_with("/release-group") {
            let artist = query.split('&').find_map(|kv| kv.strip_prefix("artist=")).unwrap_or("");
            let offset: usize = query.split('&').find_map(|kv| kv.strip_prefix("offset=")).and_then(|o| o.parse().ok()).unwrap_or(0);
            let all = self.groups.get(artist).cloned().unwrap_or_default();
            let page: Vec<serde_json::Value> = all
                .iter()
                .skip(offset)
                .enumerate()
                .map(|(i, t)| serde_json::json!({ "id": format!("rg-{artist}-{i}"), "title": t, "primary-type": "Album", "first-release-date": "2020" }))
                .collect();
            return serde_json::json!({ "release-groups": page, "release-group-count": all.len() }).to_string();
        }
        serde_json::json!({ "releases": [], "release-count": 0, "release-groups": [], "release-group-count": 0, "artists": [] }).to_string()
    }

    async fn serve(self) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mb = Arc::new(self);
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                let mb = mb.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = socket.read(&mut buf).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let target = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let body = mb.respond(&target);
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    socket.write_all(response.as_bytes()).await.ok();
                });
            }
        });
        format!("http://{addr}/ws/2")
    }
}

struct Run {
    code: i32,
    output: String,
}

fn run_add(db_url: &str, mb_url: &str, music_dir: &Path, mbid: &str) -> Run {
    let cwd = tempdir("add-cwd");
    let out = Command::new(env!("CARGO_BIN_EXE_add"))
        .args(["--mbid", mbid])
        .current_dir(&cwd)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("DATABASE_URL", db_url)
        .env("MUSIC_DIR", music_dir)
        .env("MB_BASE_URL", mb_url)
        .env("IMAGE_DIR", cwd.join("img"))
        .output()
        .expect("run add");
    Run {
        code: out.status.code().unwrap_or(-1),
        output: format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)),
    }
}

fn tempdir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("{prefix}-{}", cuid2::create_id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

async fn pool() -> (PgPool, String) {
    let url = std::env::var("SMOKE_TEST_DATABASE_URL").expect("set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres");
    (PgPool::connect(&url).await.expect("connect"), url)
}

fn uuid(seed: &str) -> String {
    let h: String = format!("{:x}", md5_like(seed)).chars().chain(std::iter::repeat('0')).take(32).collect();
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

fn md5_like(seed: &str) -> u128 {
    seed.bytes().fold(0xcbf29ce484222325u128, |h, b| (h ^ b as u128).wrapping_mul(0x100000001b3))
}

async fn artist(pool: &PgPool, name: &str, mbid: Option<&str>) -> String {
    let id = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "Artist" (id, name, slug, "musicbrainzId", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 0, 0, now() - interval '2 days', now())"#,
    )
    .bind(&id)
    .bind(name)
    .bind(common::slug::make_slug(name))
    .bind(mbid)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn own(pool: &PgPool, artist_id: &str, title: &str) {
    let release = cuid2::create_id();
    sqlx::query(r#"INSERT INTO "LocalRelease" (id, title, "groupKey", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())"#)
        .bind(&release)
        .bind(title)
        .bind(format!("folder:add-homonyms/{release}"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt") VALUES ($1, $2, $3, now())"#)
        .bind(cuid2::create_id())
        .bind(&release)
        .bind(artist_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn slug(pool: &PgPool, id: &str) -> String {
    sqlx::query_scalar(r#"SELECT slug FROM "Artist" WHERE id = $1"#).bind(id).fetch_one(pool).await.unwrap()
}

async fn by_mbid(pool: &PgPool, mbid: &str) -> Vec<(String, String)> {
    sqlx::query_as(r#"SELECT id, slug FROM "Artist" WHERE "musicbrainzId" = $1"#).bind(mbid).fetch_all(pool).await.unwrap()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn a_different_artist_with_the_same_name_is_added_beside_the_existing_one() {
    let (pool, url) = pool().await;
    let name = format!("Napa {}", &cuid2::create_id()[..6]);
    let base = common::slug::make_slug(&name);
    let (pt, cl) = (uuid(&format!("pt{name}")), uuid(&format!("cl{name}")));
    let existing = artist(&pool, &name, Some(&pt)).await;
    let music = tempdir("add-music");
    std::fs::create_dir(music.join(&name)).unwrap();

    let mut mb = Mb::default();
    mb.artists.insert(pt.clone(), (name.clone(), Some("PT".into())));
    mb.artists.insert(cl.clone(), (name.clone(), Some("CL".into())));
    mb.groups.insert(cl.clone(), vec!["Tensión".into()]);
    let run = run_add(&url, &mb.serve().await, &music, &cl);

    assert_eq!(run.code, 0, "{}", run.output);
    let added = by_mbid(&pool, &cl).await;
    assert_eq!(added.len(), 1);
    assert_eq!(added[0].1, format!("{base}-{}", &cl[..8]));
    assert_eq!(slug(&pool, &existing).await, format!("{base}-{}", &pt[..8]), "the existing artist moved off the bare slug");
    assert!(music.join(format!("{name} ({})", &cl[..8])).is_dir(), "its own folder, never the other artist's");
    let redirect: String = sqlx::query_scalar(r#"SELECT "artistId" FROM "ArtistSlugHistory" WHERE "oldSlug" = $1"#)
        .bind(&base)
        .fetch_optional(&pool)
        .await
        .unwrap()
        .unwrap_or_default();
    assert_eq!(redirect, "", "the bare slug is the chooser's");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn the_same_artist_is_still_refused() {
    let (pool, url) = pool().await;
    let name = format!("Napa {}", &cuid2::create_id()[..6]);
    let pt = uuid(&format!("pt{name}"));
    artist(&pool, &name, Some(&pt)).await;
    let mut mb = Mb::default();
    mb.artists.insert(pt.clone(), (name.clone(), Some("PT".into())));
    let run = run_add(&url, &mb.serve().await, &tempdir("add-music"), &pt);
    assert_eq!(run.code, 3, "{}", run.output);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn an_unidentified_artist_whose_albums_are_this_artists_is_linked_not_duplicated() {
    let (pool, url) = pool().await;
    let name = format!("Napa {}", &cuid2::create_id()[..6]);
    let base = common::slug::make_slug(&name);
    let (pt, cl) = (uuid(&format!("pt{name}")), uuid(&format!("cl{name}")));
    let existing = artist(&pool, &name, None).await;
    own(&pool, &existing, "Tension").await;

    let mut mb = Mb::default();
    mb.artists.insert(pt.clone(), (name.clone(), Some("PT".into())));
    mb.artists.insert(cl.clone(), (name.clone(), Some("CL".into())));
    mb.groups.insert(pt.clone(), vec!["Senso Comum".into()]);
    mb.groups.insert(cl.clone(), vec!["Tensión".into()]);
    let run = run_add(&url, &mb.serve().await, &tempdir("add-music"), &cl);

    assert_eq!(run.code, 0, "{}", run.output);
    let rows = by_mbid(&pool, &cl).await;
    assert_eq!(rows, vec![(existing.clone(), base.clone())], "the existing row took the id; nothing new, bare slug kept");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn an_unidentified_artist_that_matches_nothing_stays_beside_the_new_one() {
    let (pool, url) = pool().await;
    let name = format!("Napa {}", &cuid2::create_id()[..6]);
    let base = common::slug::make_slug(&name);
    let cl = uuid(&format!("cl{name}"));
    let existing = artist(&pool, &name, None).await;
    own(&pool, &existing, "Nothing Like It").await;

    let mut mb = Mb::default();
    mb.artists.insert(cl.clone(), (name.clone(), Some("CL".into())));
    mb.groups.insert(cl.clone(), vec!["Tensión".into()]);
    let run = run_add(&url, &mb.serve().await, &tempdir("add-music"), &cl);

    assert_eq!(run.code, 0, "{}", run.output);
    assert_eq!(by_mbid(&pool, &cl).await[0].1, format!("{base}-{}", &cl[..8]));
    let token: String = existing.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    assert_eq!(slug(&pool, &existing).await, format!("{base}-{token}"), "the unidentified one is suffixed by its own id");
}
