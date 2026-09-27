//! `./tidy --split-homonyms` - the one-off repair - as the real binary, against a disposable Postgres and a stub
//! MusicBrainz. `#[ignore]`d; `scripts/test-db` runs it.
//!
//! Safety: started from an empty temp directory with DATABASE_URL set explicitly, so web/.env (production) is never
//! read - dotenvy never overrides a variable that is already set.

use std::path::PathBuf;
use std::process::Command;

use sqlx::PgPool;
use common::testing::MbStub;

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


fn run_tidy(db_url: &str, mb_url: &str, args: &[&str]) -> (i32, String) {
    let cwd = tempdir("tidy-cwd");
    let out = Command::new(env!("CARGO_BIN_EXE_tidy"))
        .args(args)
        .current_dir(&cwd)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("DATABASE_URL", db_url)
        .env("MB_BASE_URL", mb_url)
        .env("IMAGE_DIR", cwd.join("img"))
        .output()
        .expect("run tidy");
    (out.status.code().unwrap_or(-1), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

/// A release in `folder` owned by `owner`, whose one track names `mbid` as its album artist (or nothing).
async fn release(pool: &PgPool, owner: &str, name: &str, title: &str, mbid: Option<&str>) -> String {
    let id = cuid2::create_id();
    sqlx::query(r#"INSERT INTO "LocalRelease" (id, title, "groupKey", "folderPath", "createdAt", "updatedAt") VALUES ($1, $2, $3, $3, now(), now())"#)
        .bind(&id)
        .bind(title)
        .bind(format!("folder:split/{id}"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(r#"INSERT INTO "LocalReleaseArtist" (id, "localReleaseId", "artistId", "createdAt") VALUES ($1, $2, $3, now())"#)
        .bind(cuid2::create_id())
        .bind(&id)
        .bind(owner)
        .execute(pool)
        .await
        .unwrap();
    let (names, ids): (Vec<String>, Vec<String>) = match mbid {
        Some(m) => (vec![name.to_string()], vec![m.to_string()]),
        None => (vec![], vec![]),
    };
    sqlx::query(
        r#"INSERT INTO "LocalReleaseTrack" (id, title, artist, "albumArtist", album, "filePath", "localReleaseId", "albumArtists", "mbAlbumArtistIds", "createdAt", "updatedAt")
           VALUES ($1, 'T', $2, $2, $3, $4, $5, $6, $7, now(), now())"#,
    )
    .bind(cuid2::create_id())
    .bind(name)
    .bind(title)
    .bind(format!("split/{id}/01.mp3"))
    .bind(&id)
    .bind(&names)
    .bind(&ids)
    .execute(pool)
    .await
    .unwrap();
    id
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn a_merged_artist_is_split_by_its_files_ids_and_a_mistagged_file_is_not() {
    let (pool, url) = pool().await;
    let name = format!("Napa {}", &cuid2::create_id()[..6]);
    let base = common::slug::make_slug(&name);
    let pt = uuid(&format!("pt{name}"));
    let kr = uuid(&format!("kr{name}"));
    let other = uuid(&format!("other{name}"));

    let merged = cuid2::create_id();
    sqlx::query(
        r#"INSERT INTO "Artist" (id, name, slug, "musicbrainzId", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 0, 0, now() - interval '2 days', now())"#,
    )
    .bind(&merged)
    .bind(&name)
    .bind(&base)
    .bind(&pt)
    .execute(&pool)
    .await
    .unwrap();
    // The name cache as the old resolver left it: the name means PT, so a file naming KR looks like a mistag.
    sqlx::query(r#"INSERT INTO "MbArtistLookup" (id, name, normalized, mbid, "mbName", "checkedAt") VALUES ($1, $2, $3, $4, $2, now())"#)
        .bind(cuid2::create_id())
        .bind(&name)
        .bind(common::mb::names::normalize_name(&name))
        .bind(&pt)
        .execute(&pool)
        .await
        .unwrap();
    let senso = release(&pool, &merged, &name, "Senso Comum", Some(&pt)).await;
    let eleven = release(&pool, &merged, &name, "11-11", Some(&kr)).await;
    let mistag = release(&pool, &merged, &name, "Mistagged", Some(&other)).await;

    let mut mb = MbStub::default();
    mb.artists.insert(pt.clone(), (name.clone(), Some("PT".into())));
    mb.artists.insert(kr.clone(), (name.clone(), Some("KR".into())));
    // MusicBrainz calls `other` something else entirely: that file is mistagged, not a third Napa.
    mb.artists.insert(other.clone(), ("Somebody Else".into(), None));
    let mb_url = mb.serve().await;

    let (code, out) = run_tidy(&url, &mb_url, &["--split-homonyms", "--dry-run"]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains(&name), "the dry run lists the merged artist: {out}");
    let unchanged: String = sqlx::query_scalar(r#"SELECT slug FROM "Artist" WHERE id = $1"#).bind(&merged).fetch_one(&pool).await.unwrap();
    assert_eq!(unchanged, base, "a dry run changes nothing");

    let ids_file = tempdir("tidy-ids").join("ids.txt");
    let (code, out) = run_tidy(&url, &mb_url, &["--split-homonyms", "--emit-artist-ids", ids_file.to_str().unwrap()]);
    assert_eq!(code, 0, "{out}");

    let owner = |release: String| {
        let pool = pool.clone();
        async move {
            sqlx::query_as::<_, (Option<String>, String)>(
                r#"SELECT a."musicbrainzId", a.slug FROM "LocalReleaseArtist" l JOIN "Artist" a ON a.id = l."artistId" WHERE l."localReleaseId" = $1"#,
            )
            .bind(release)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(owner(senso).await, (Some(pt.clone()), format!("{base}-{}", &pt[..8])));
    assert_eq!(owner(eleven).await, (Some(kr.clone()), format!("{base}-{}", &kr[..8])));
    let (mistag_id, _) = owner(mistag).await;
    assert_ne!(mistag_id.as_deref(), Some(other.as_str()), "a mistagged file never makes an artist of its wrong id");

    let written = std::fs::read_to_string(&ids_file).unwrap();
    assert!(written.lines().any(|l| l == merged), "the ids file lists the group for the follow-up sync");
    let violations: Vec<(String, String)> = common::homonyms::violations(&pool).await.unwrap().into_iter().filter(|(b, _)| *b == base).collect();
    assert!(violations.is_empty(), "{violations:?}");
}
