//! Audit item 11: end-to-end smoke test running the REAL compiled `index` and `sync` binaries
//! against a scratch Postgres database, asserting the catalogue actually flips (LocalRelease bound
//! COMPLETE, tracks linked) — the one thing every other test in this codebase mocks away.
//!
//! No hardcoded MusicBrainz release id or tracklist: the test looks up a famous, stable release LIVE
//! via the MB API at run time and uses whatever MusicBrainz currently returns, so it can't drift out
//! of sync with reality the way a hardcoded fixture would if that release were ever re-edited.
//!
//! This lives under `tests/` (an integration test, not a unit test inside src/) specifically so Cargo
//! populates `CARGO_BIN_EXE_sync` — that env var is only set for test targets outside the binary's own
//! crate root, so a `#[cfg(test)]` module inside `src/main.rs` cannot see it. `index` isn't a
//! dependency of this package, so its path is derived relative to `CARGO_BIN_EXE_sync` (Cargo places
//! every workspace binary in the same target directory).
//!
//! NOT run by CI or a plain `cargo test` — network- and external-service-dependent, and this
//! environment had no outbound network access available to develop/verify it against a live
//! MusicBrainz response or a real Postgres instance, so treat this as reviewed-but-unexecuted code and
//! run it once by hand before relying on it:
//!
//!   1. cd scripts && cargo build --release        # both `index` and `sync` must exist in target/
//!   2. point SMOKE_TEST_DATABASE_URL at a disposable Postgres with the Prisma schema migrated
//!      (never the production DATABASE_URL — this test writes real rows and deletes them after)
//!   3. SMOKE_TEST_DATABASE_URL=postgres://... cargo test -p sync --release --test catalogue_smoke \
//!        -- --ignored --nocapture

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

// Mirrors sync::mb_api::USER_AGENT / RateLimiter's 1.1s floor — duplicated rather than reused since
// this integration test can't reach into the `sync` binary crate's internal modules (no lib target).
const MB_USER_AGENT: &str = "DMPv6/0.1.0 ( https://github.com/dmp )";
const MB_MIN_DELAY: Duration = Duration::from_millis(1100);

#[tokio::test]
#[ignore]
async fn catalogue_smoke_real_binaries_index_and_sync() {
    let db_url = std::env::var("SMOKE_TEST_DATABASE_URL").expect(
        "set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres — this test never runs \
         against the production DATABASE_URL",
    );
    let pool = common::db::create_pool(&db_url).await;

    let http = reqwest::Client::new();

    // 1. Live discovery: a hugely famous, essentially permanent release. Reading its current
    // tracklist live (rather than hardcoding one from memory) means the fixture always matches
    // whatever MusicBrainz has right now.
    let search: serde_json::Value = http
        .get("https://musicbrainz.org/ws/2/release/")
        .query(&[
            ("query", "release:\"The Dark Side of the Moon\" AND artist:\"Pink Floyd\" AND status:official"),
            ("fmt", "json"),
            ("limit", "5"),
        ])
        .header("User-Agent", MB_USER_AGENT)
        .send().await.expect("MB search request failed")
        .json().await.expect("MB search response not JSON");
    let release_id = search["releases"][0]["id"].as_str()
        .expect("no releases found in MB search — MusicBrainz may be unreachable or the query is stale")
        .to_string();

    tokio::time::sleep(MB_MIN_DELAY).await;
    let detail: serde_json::Value = http
        .get(format!("https://musicbrainz.org/ws/2/release/{release_id}"))
        .query(&[("inc", "recordings+artist-credits+release-groups"), ("fmt", "json")])
        .header("User-Agent", MB_USER_AGENT)
        .send().await.expect("MB release lookup failed")
        .json().await.expect("MB release response not JSON");

    let release_group_id = detail["release-group"]["id"].as_str().expect("no release-group id in MB response").to_string();
    let artist_mb_id = detail["artist-credit"][0]["artist"]["id"].as_str().expect("no artist-credit id in MB response").to_string();
    let artist_name = detail["artist-credit"][0]["artist"]["name"].as_str().unwrap_or("Pink Floyd").to_string();
    let track_titles: Vec<String> = detail["media"][0]["tracks"].as_array()
        .expect("no tracks on the first medium in MB response")
        .iter()
        .map(|t| t["title"].as_str().unwrap_or("Untitled").to_string())
        .collect();
    assert!(!track_titles.is_empty(), "live MB lookup returned zero tracks — can't build a fixture");

    // 2. Fixture folder: one tiny silent mp3 per track, laid out the way a completed download would
    // be (Artist/Year - Album), tagged with the artist/title/year (index's own extraction) and the MB
    // ids just fetched (via the SAME write_mb_ids helper production uses after a real sync writes
    // tags back to files — if index can't read what that function writes, that's a genuine bug this
    // test is designed to catch, not a fixture-construction error).
    let unique = cuid2::create_id();
    let music_dir = std::env::temp_dir().join(format!("dmp-smoke-{unique}"));
    let album_rel = format!("{artist_name}/2020 - Smoke Test Album [{unique}]");
    let album_dir = music_dir.join(&album_rel);
    std::fs::create_dir_all(&album_dir).expect("mkdir fixture album dir");

    for (i, title) in track_titles.iter().enumerate() {
        let file = album_dir.join(format!("{:02}. {}.mp3", i + 1, title.replace(['/', '\\'], "_")));
        let status = Command::new("ffmpeg")
            .args(["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1"])
            .args(["-c:a", "libmp3lame", "-b:a", "64k"])
            .args(["-metadata", &format!("title={title}")])
            .args(["-metadata", &format!("artist={artist_name}")])
            .args(["-metadata", &format!("album_artist={artist_name}")])
            .args(["-metadata", "album=Smoke Test Album"])
            .args(["-metadata", "date=2020"])
            .args(["-metadata", &format!("track={}", i + 1)])
            .arg(&file)
            .status()
            .expect("ffmpeg not on PATH — required to generate the fixture audio");
        assert!(status.success(), "ffmpeg failed to generate fixture track {i}: {title}");

        common::tags::write_mb_ids(
            &file,
            Some(&artist_mb_id),
            Some(&release_id),
            Some(&release_group_id),
            None, // per-track recording id isn't needed for the completeness match itself
            false,
        ).expect("failed to write MB tags to fixture file");
    }

    // 3. Seed the Artist row directly with the real MB id, matching ensure_artist_cached's own
    // ON CONFLICT (slug) upsert key exactly — otherwise index would silently create a SECOND,
    // slug-mismatched Artist row instead of reusing this one, orphaning the seeded musicbrainzId and
    // leaving sync to fuzzy-match by name instead of exercising the direct-id path.
    let artist_id = cuid2::create_id();
    let artist_slug = common::slug::make_slug(&artist_name);
    sqlx::query(
        r#"INSERT INTO "Artist"
             (id, name, slug, "musicbrainzId", monitored, "relatedOnly",
              "totalPlayCount", "totalTracks", "totalFileSize", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, true, false, 0, 0, 0, now(), now())
           ON CONFLICT (slug) DO UPDATE SET "musicbrainzId" = EXCLUDED."musicbrainzId""#,
    )
    .bind(&artist_id)
    .bind(&artist_name)
    .bind(&artist_slug)
    .bind(&artist_mb_id)
    .execute(&pool)
    .await
    .expect("insert fixture Artist");

    // 4. Run the REAL compiled binaries — this is the whole point: no execFile mock.
    let sync_bin = PathBuf::from(env!("CARGO_BIN_EXE_sync"));
    let index_bin = sync_bin.with_file_name("index");
    let scripts_root = sync_bin.parent().and_then(|p| p.parent()).and_then(|p| p.parent())
        .expect("unexpected target dir layout").to_path_buf();
    assert!(index_bin.exists(), "index binary not found at {index_bin:?} — run `cargo build --release` for the whole workspace first");

    let index_status = Command::new(&index_bin)
        .current_dir(&scripts_root)
        .env("DATABASE_URL", &db_url)
        .env("MUSIC_DIR", &music_dir)
        .args(["--folders", &album_rel, "--skip-covers"])
        .status()
        .expect("failed to spawn index binary");
    assert!(index_status.success(), "index binary exited non-zero");

    let local_release_id: String = sqlx::query_scalar(
        r#"SELECT id FROM "LocalRelease" WHERE "folderPath" = $1"#,
    )
    .bind(&album_rel)
    .fetch_one(&pool)
    .await
    .expect("index did not create the expected LocalRelease — check its stdout above");

    let sync_status = Command::new(&sync_bin)
        .current_dir(&scripts_root)
        .env("DATABASE_URL", &db_url)
        .env("MUSIC_DIR", &music_dir)
        .args(["--release", &local_release_id, "--skip-mb-tags", "--skip-release-img"])
        .status()
        .expect("failed to spawn sync binary");
    assert!(sync_status.success(), "sync binary exited non-zero");

    // 5. Assert the catalogue actually flipped: bound COMPLETE, every track linked.
    let (bound_release_id, match_status): (Option<String>, Option<String>) = sqlx::query_as(
        r#"SELECT "releaseId", "matchStatus"::text FROM "LocalRelease" WHERE id = $1"#,
    )
    .bind(&local_release_id)
    .fetch_one(&pool)
    .await
    .expect("LocalRelease vanished after sync");

    assert!(bound_release_id.is_some(), "sync did not bind a MusicBrainzRelease — LocalRelease.releaseId is still null");
    assert_eq!(match_status.as_deref(), Some("COMPLETE"), "expected an exact track-count match against the live release");

    let track_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM "MusicBrainzReleaseTrack" WHERE "releaseId" = $1"#,
    )
    .bind(bound_release_id.as_ref().unwrap())
    .fetch_one(&pool)
    .await
    .expect("track count query failed");
    assert_eq!(track_count as usize, track_titles.len(), "catalogue track count doesn't match the live MB tracklist");

    // Cleanup: best-effort, this is a scratch DB, but tidy up so repeated runs don't collide.
    sqlx::query(r#"DELETE FROM "Artist" WHERE id = $1"#).bind(&artist_id).execute(&pool).await.ok();
    std::fs::remove_dir_all(&music_dir).ok();
}
