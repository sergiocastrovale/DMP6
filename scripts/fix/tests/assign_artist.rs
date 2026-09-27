//! `./fix --assign-artist` on a real file, against a disposable Postgres. `#[ignore]`d; `scripts/test-db` runs it.
//! Skips with a message when ffmpeg is not on PATH.
//!
//! Safety: the binary is started from an empty temp directory with DATABASE_URL set explicitly, so web/.env
//! (production) is never read - dotenvy never overrides a variable that is already set.

use std::path::{Path, PathBuf};
use std::process::Command;

use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::ItemKey;

fn tempdir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("{prefix}-{}", cuid2::create_id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A one-second mp3 whose album artist is `album_artist` and whose album-artist id is `mbid` - the shape of a file
/// Picard tagged with the wrong one of two same-named artists.
fn mp3(path: &Path, album_artist: &str, mbid: &str) -> bool {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("ffmpeg not on PATH - skipping");
        return false;
    }
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let ok = Command::new("ffmpeg")
        .args([
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=44100:cl=mono",
            "-t",
            "1",
            "-c:a",
            "libmp3lame",
        ])
        .args([
            "-metadata",
            "title=Tension",
            "-metadata",
            &format!("album_artist={album_artist}"),
            "-metadata",
            "album=11-11",
        ])
        .args(["-metadata", &format!("MusicBrainz Album Artist Id={mbid}")])
        .arg(path)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(ok, "ffmpeg failed");
    true
}

fn album_artist_id(path: &Path) -> Option<String> {
    let tagged = Probe::open(path).unwrap().read().unwrap();
    tagged.primary_tag().and_then(|t| {
        t.get_string(ItemKey::MusicBrainzReleaseArtistId)
            .map(str::to_string)
    })
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn the_chosen_artists_id_is_written_into_every_file_and_the_folder_re_indexed() {
    let url = std::env::var("SMOKE_TEST_DATABASE_URL")
        .expect("set SMOKE_TEST_DATABASE_URL to a disposable, migrated Postgres");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let music = tempdir("fix-music");
    let wrong = "9f3423ee-debe-48ec-b78d-281438aaf626";
    let right = "d76eeba7-d35c-4fe8-bffa-ce2885c97765";
    let tag = cuid2::create_id()[..6].to_string();
    let folder = format!("Napa {tag}/11-11");
    let file = music.join(&folder).join("01.mp3");
    if !mp3(&file, &format!("Napa {tag}"), wrong) {
        return;
    }
    assert_eq!(
        album_artist_id(&file).as_deref(),
        Some(wrong),
        "fixture carries the wrong id"
    );

    let release = cuid2::create_id();
    sqlx::query(r#"INSERT INTO "LocalRelease" (id, title, "groupKey", "folderPath", "createdAt", "updatedAt") VALUES ($1, '11-11', $2, $3, now(), now())"#)
        .bind(&release)
        .bind(format!("folder:{folder}"))
        .bind(&folder)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(r#"INSERT INTO "LocalReleaseTrack" (id, title, "filePath", "localReleaseId", "createdAt", "updatedAt") VALUES ($1, 'Tension', $2, $3, now(), now())"#)
        .bind(cuid2::create_id())
        .bind(format!("{folder}/01.mp3"))
        .bind(&release)
        .execute(&pool)
        .await
        .unwrap();

    let cwd = tempdir("fix-cwd");
    let out = Command::new(env!("CARGO_BIN_EXE_fix"))
        .args(["--assign-artist", "--release", &release, "--mbid", right])
        .current_dir(&cwd)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("DATABASE_URL", &url)
        .env("MUSIC_DIR", &music)
        .env("IMAGE_DIR", cwd.join("img"))
        .env("MB_BASE_URL", "http://127.0.0.1:9/ws/2")
        .output()
        .unwrap();
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(out.status.success(), "{log}");
    assert_eq!(album_artist_id(&file).as_deref(), Some(right), "{log}");
    assert!(log.contains("Re-indexing affected folders"), "{log}");
    assert!(
        log.contains(&folder),
        "the release's own folder is re-indexed: {log}"
    );
}
