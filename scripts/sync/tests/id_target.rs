//! `./sync --id`: selects exactly one Artist row, unambiguous even when its name is shared, and
//! bypasses the pending (lastIndexedAt > lastSyncedAt) gate the same way `--artist-ids` does.
//! `#[ignore]`d; `scripts/test-db` runs it - offline (`MB_BASE_URL` points nowhere), so an artist
//! with no local releases and no catalogue makes no MusicBrainz call and exits clean, which is all
//! this checks: which artist got selected, not what sync then does with it.

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

fn run_sync(db_url: &str, args: &[&str]) -> (i32, String) {
    let cwd = tempdir("sync-cwd");
    let out = Command::new(env!("CARGO_BIN_EXE_sync"))
        .args(args)
        .current_dir(&cwd)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("DATABASE_URL", db_url)
        .env("MB_BASE_URL", "http://127.0.0.1:9/ws/2")
        .env("IMAGE_DIR", cwd.join("img"))
        .output()
        .expect("run sync");
    (out.status.code().unwrap_or(-1), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

async fn artist(pool: &PgPool, name: &str, last_indexed: Option<&str>) -> String {
    let id = cuid2::create_id();
    sqlx::query(&format!(
        r#"INSERT INTO "Artist" (id, name, slug, "totalTracks", "totalFileSize", "lastIndexedAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 0, 0, {}, now(), now())"#,
        last_indexed.map(|_| "now()").unwrap_or("NULL")
    ))
    .bind(&id)
    .bind(name)
    .bind(format!("{}-{}", common::slug::make_slug(name), &id[..6]))
    .execute(pool)
    .await
    .unwrap();
    id
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn an_id_selects_exactly_that_row_and_bypasses_the_pending_gate() {
    let pool = pool().await;
    let url = std::env::var("SMOKE_TEST_DATABASE_URL").unwrap();
    let name = format!("Homonym {}", &cuid2::create_id()[..6]);
    // Neither row has ever been indexed (lastIndexedAt NULL) - the ordinary pending gate would select neither.
    let a = artist(&pool, &name, None).await;
    let _b = artist(&pool, &name, None).await;

    let (code, out) = run_sync(&url, &["--id", &a, "--web"]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("\"total\":1") || out.contains("Processing 1 artist"), "selects exactly one artist, not the pending set (0) or both by name: {out}");

    let (code, out) = run_sync(&url, &["--id", "nonexistent-id", "--web"]);
    assert_eq!(code, 0, "{out}");
    assert!(!out.contains("Processing 1 artist"), "an unknown id selects nothing: {out}");
}
