//! `./fix --assign-artist`: say which artist a release belongs to by writing that artist's MusicBrainz id into its
//! files (docs/sync_decisions.md "Two artists, one name"). The files stay the source of truth - the web app's "Assign
//! to artist" action and the download merge both come through here, and the re-index `fix` chains afterwards is what
//! moves the release.

use std::path::{Path, PathBuf};

use common::images::RELEASE_AUDIO_EXTENSIONS;
use common::progress::Reporter;
use common::tags::{write_mb_ids, MbTagIds};
use sqlx::PgPool;

use crate::tags::resolve_path;

/// Which files to write: a release's tracks as indexed, or every audio file under a folder (a download that has not
/// been indexed yet), relative to MUSIC_DIR or absolute.
pub enum Target<'a> {
    Release(&'a str),
    Folder(&'a str),
}

fn audio_files_under(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            audio_files_under(&path, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| RELEASE_AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        {
            out.push(path);
        }
    }
}

/// Writes `mbid` as the album-artist id of every file in `target`. Returns (files written, files failed, folders to
/// re-index relative to MUSIC_DIR).
pub async fn assign(
    pool: &PgPool,
    music_dir: &str,
    target: Target<'_>,
    mbid: &str,
    dry_run: bool,
    reporter: &Reporter,
) -> Result<(usize, usize, Vec<String>), String> {
    let files: Vec<PathBuf> = match target {
        Target::Release(id) => {
            let paths: Vec<String> = sqlx::query_scalar(r#"SELECT "filePath" FROM "LocalReleaseTrack" WHERE "localReleaseId" = $1 ORDER BY "filePath""#)
                .bind(id)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;
            if paths.is_empty() {
                return Err(format!("release {} has no tracks", id));
            }
            paths.iter().map(|p| resolve_path(music_dir, p)).collect()
        }
        Target::Folder(folder) => {
            let dir = resolve_path(music_dir, folder);
            let mut out = Vec::new();
            audio_files_under(&dir, &mut out);
            out.sort();
            if out.is_empty() {
                return Err(format!("no audio files under {}", dir.display()));
            }
            out
        }
    };

    let ids = MbTagIds {
        album_artist: Some(mbid),
        ..MbTagIds::default()
    };
    let (mut ok, mut failed) = (0usize, 0usize);
    let mut folders: Vec<String> = Vec::new();
    for file in &files {
        if dry_run {
            reporter.nested().info(&format!(
                "[dry-run] would write the album-artist id into {}",
                file.display()
            ));
            ok += 1;
            continue;
        }
        // force: replacing the id is the whole point.
        match write_mb_ids(file, &ids, true) {
            Ok(_) => {
                ok += 1;
                let relative = file.strip_prefix(music_dir).unwrap_or(file);
                if let Some(folder) = relative
                    .parent()
                    .and_then(|p| p.to_str())
                    .filter(|p| !p.is_empty())
                {
                    let folder = folder.trim_start_matches('/').to_string();
                    if !folders.contains(&folder) {
                        folders.push(folder);
                    }
                }
            }
            Err(e) => {
                failed += 1;
                reporter
                    .nested()
                    .warn(&format!("{}: {}", file.display(), e));
            }
        }
    }
    Ok((ok, failed, folders))
}
