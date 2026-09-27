//! `./delete --id`: targets exactly one Artist row, unambiguous even when its name is shared
//! (docs/sync_decisions.md "Two artists, one name"). `#[ignore]`d; `scripts/test-db` runs it:
//!
//!   SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p delete --test id_target -- --ignored

use std::path::PathBuf;
use std::process::Command;

use sqlx::PgPool;

async fn pool() -> PgPool {
    let url = std::env::var("SMOKE_TEST_DATABASE_URL").expect("set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres");
    PgPool::connect(&url).await.expect("connect")
}

fn tempdir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("{prefix}-{}", cuid2::create_id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn run_delete(db_url: &str, args: &[&str]) -> (i32, String) {
    let cwd = tempdir("delete-cwd");
    let out = Command::new(env!("CARGO_BIN_EXE_delete"))
        .args(args)
        .current_dir(&cwd)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("DATABASE_URL", db_url)
        .output()
        .expect("run delete");
    (out.status.code().unwrap_or(-1), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

async fn artist(pool: &PgPool, name: &str) -> String {
    let id = cuid2::create_id();
    sqlx::query(r#"INSERT INTO "Artist" (id, name, slug, "totalTracks", "totalFileSize", "createdAt", "updatedAt") VALUES ($1, $2, $3, 0, 0, now(), now())"#)
        .bind(&id)
        .bind(name)
        .bind(format!("{}-{}", common::slug::make_slug(name), &id[..6]))
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn own(pool: &PgPool, artist_id: &str) {
    let release = cuid2::create_id();
    sqlx::query(r#"INSERT INTO "LocalRelease" (id, title, "groupKey", "createdAt", "updatedAt") VALUES ($1, 'R', $2, now(), now())"#)
        .bind(&release)
        .bind(format!("folder:id-target/{release}"))
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

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn a_shared_name_refuses_by_name_but_id_targets_exactly_one() {
    let pool = pool().await;
    let url = std::env::var("SMOKE_TEST_DATABASE_URL").unwrap();
    let name = format!("Homonym {}", &cuid2::create_id()[..6]);
    let a = artist(&pool, &name).await;
    let b = artist(&pool, &name).await;
    own(&pool, &a).await;
    own(&pool, &b).await;

    let (code, out) = run_delete(&url, &[&name, "--dry-run"]);
    assert_eq!(code, 1, "{out}");
    assert!(out.contains("ambiguous") || out.contains("2 artists match"), "{out}");

    let (code, out) = run_delete(&url, &["--id", &a, "--dry-run"]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("Artists to delete"), "{out}");
    assert!(!out.contains(&b), "must never touch the other same-named row: {out}");

    let (code, out) = run_delete(&url, &["--id", "nonexistent-id", "--dry-run"]);
    assert_eq!(code, 1, "{out}");
    assert!(out.contains("No artist found"), "{out}");
}
