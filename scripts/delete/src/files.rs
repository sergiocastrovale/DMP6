//! Physical audio-file removal for `--files`.
//!
//! Everything here is guarded by one rule: a path only gets deleted if it resolves *inside* the
//! configured `MUSIC_DIR`. `LocalReleaseTrack.filePath` is stored RELATIVE to `MUSIC_DIR` (e.g.
//! `"Artist/Album/01.flac"` - see `index::deletion::detect_deleted_folders`'s own
//! `SPLIT_PART("filePath", '/', 1)` for the artist-folder segment, which only makes sense read that
//! way), so every raw path is joined onto `MUSIC_DIR` before resolving. A raw path that already
//! happens to be absolute (a hand-edited row, or some future indexer change) is left as-is instead of
//! double-joined. Resolution goes through the parent directory (`canonical_parent`), so a symlinked
//! album folder that escapes the library is caught even though the file itself is real, and a moved
//! library or a `..` segment in a hand-edited row can't point the delete at anything outside it.

use std::fs;
use std::path::{Path, PathBuf};

/// Pure containment check on two ALREADY-canonical paths. Split out from the filesystem work so the
/// blast-radius rule itself is directly testable without touching disk. A `..` component is rejected
/// outright: `starts_with` is a component-prefix test, so `/music/../etc/passwd` would otherwise read
/// as "inside /music". Canonical paths never contain one, so this only ever rejects unresolved input.
pub fn is_inside(candidate: &Path, root: &Path) -> bool {
    use std::path::Component;

    candidate != root
        && candidate.starts_with(root)
        && !candidate.components().any(|c| c == Component::ParentDir)
}

/// Canonicalises the parent directory of `path` and re-appends the file name. The file itself is not
/// canonicalised: a symlinked *file* pointing outside the library still lives inside it, and removing
/// the link is what the operator asked for. Returns None when the parent is gone or unreadable.
pub fn canonical_parent(path: &Path) -> Option<PathBuf> {
    let parent = path.parent()?;
    let name = path.file_name()?;
    fs::canonicalize(parent).ok().map(|p| p.join(name))
}

/// Resolved, in-library path for `raw` (a DB `filePath`, relative to `MUSIC_DIR` in normal operation -
/// see the module doc), or None when it does not exist, cannot be resolved, or falls outside
/// `music_root` (which must already be canonical).
pub fn resolve_in_library(raw: &str, music_root: &Path) -> Option<PathBuf> {
    let candidate = Path::new(raw);
    let full = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        music_root.join(candidate)
    };
    let resolved = canonical_parent(&full)?;
    is_inside(&resolved, music_root).then_some(resolved)
}

/// Removes every empty directory from `start` upward, stopping at (and never removing) `root`.
/// Returns how many directories were removed.
fn prune_upwards(start: &Path, root: &Path, dry_run: bool) -> usize {
    let mut removed = 0usize;
    let mut dir = start.to_path_buf();

    while is_inside(&dir, root) {
        let empty = fs::read_dir(&dir)
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
        if !empty {
            break;
        }
        if !dry_run && fs::remove_dir(&dir).is_err() {
            break;
        }
        removed += 1;
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }

    removed
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct FileDeletion {
    pub files_removed: usize,
    pub dirs_removed: usize,
    /// Paths that were skipped because they resolved outside MUSIC_DIR or could not be resolved.
    pub skipped: Vec<String>,
}

/// Files that belong to a release folder without being music: removed together with the folder.
const SIDECAR_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "cue", "log", "txt", "nfo", "m3u",
    "m3u8", "pls", "sfv", "md5", "ffp", "accurip", "pdf",
];
const SIDECAR_NAMES: &[&str] = &[".ds_store", "thumbs.db", "desktop.ini", ".fix-touch"];

fn is_sidecar(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if SIDECAR_NAMES.contains(&name.as_str()) {
        return true;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| SIDECAR_EXTENSIONS.contains(&e.to_lowercase().as_str()))
}

/// True if `dir` holds, anywhere below it, a file that is neither one of the files this run is
/// removing (`excluding`, canonical paths - needed for `dry_run`, where nothing is gone yet) nor a
/// known sidecar. Any other file - another release's audio, an unindexed format, something unknown -
/// keeps the folder.
fn dir_has_unrelated_files(dir: &Path, excluding: &std::collections::HashSet<PathBuf>) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return true;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if dir_has_unrelated_files(&path, excluding) {
                return true;
            }
            continue;
        }
        let canonical = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !excluding.contains(&canonical) && !is_sidecar(&path) {
            return true;
        }
    }
    false
}

/// Deletes `track_paths` (a single release's `LocalReleaseTrack.filePath` values), then removes each
/// of `release_dirs` (the release's own folder(s): `folderPath` plus every `LocalReleaseMember`
/// folder) **whole, sidecars included**, but only the ones left holding nothing but sidecars.
/// Never touches anything above `release_dirs` - a shared artist folder is never a candidate here,
/// unlike `delete_files`' upward empty-dir prune.
pub fn delete_release_folders(
    track_paths: &[String],
    release_dirs: &[String],
    music_dir: &str,
    dry_run: bool,
) -> FileDeletion {
    let Ok(root) = fs::canonicalize(music_dir) else {
        return FileDeletion {
            skipped: track_paths.to_vec(),
            ..Default::default()
        };
    };

    let mut result = FileDeletion::default();
    let mut removing: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut boundary_dirs: Vec<PathBuf> = Vec::new();

    for raw in track_paths {
        let Some(resolved) = resolve_in_library(raw, &root) else {
            result.skipped.push(raw.clone());
            continue;
        };
        if dry_run || fs::remove_file(&resolved).is_ok() {
            result.files_removed += 1;
        } else {
            result.skipped.push(raw.clone());
            continue;
        }
        removing.insert(resolved.clone());
        if let Some(parent) = resolved.parent() {
            let parent = parent.to_path_buf();
            if !boundary_dirs.contains(&parent) {
                boundary_dirs.push(parent);
            }
        }
    }

    // `release_dirs` (LocalRelease.folderPath / LocalReleaseMember.folderPath) are relative to
    // MUSIC_DIR too, same as track_paths above - see resolve_in_library's doc comment.
    for raw in release_dirs {
        let candidate = Path::new(raw);
        let full = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            root.join(candidate)
        };
        if let Ok(resolved) = fs::canonicalize(&full) {
            if is_inside(&resolved, &root) && !boundary_dirs.contains(&resolved) {
                boundary_dirs.push(resolved);
            }
        }
    }

    // Deepest first, so a disc subfolder is judged (and removed) before the album folder holding it -
    // by the time the album folder is checked, an emptied disc folder is already gone from disk.
    boundary_dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));

    for dir in &boundary_dirs {
        if !is_inside(dir, &root) || !dir.exists() {
            continue;
        }
        if dir_has_unrelated_files(dir, &removing) {
            continue;
        }
        if dry_run || fs::remove_dir_all(dir).is_ok() {
            result.dirs_removed += 1;
        }
    }

    result
}

/// Deletes `paths` (absolute `LocalReleaseTrack.filePath` values) that live inside `music_dir`, then
/// prunes the directories they emptied. With `dry_run` nothing is touched - the counts describe what
/// would happen. `music_dir` is canonicalised once; if that fails, nothing is deleted.
pub fn delete_files(paths: &[String], music_dir: &str, dry_run: bool) -> FileDeletion {
    let Ok(root) = fs::canonicalize(music_dir) else {
        return FileDeletion {
            skipped: paths.to_vec(),
            ..Default::default()
        };
    };

    let mut result = FileDeletion::default();
    let mut dirs: Vec<PathBuf> = Vec::new();

    for raw in paths {
        let Some(resolved) = resolve_in_library(raw, &root) else {
            result.skipped.push(raw.clone());
            continue;
        };
        if dry_run || fs::remove_file(&resolved).is_ok() {
            result.files_removed += 1;
        } else {
            result.skipped.push(raw.clone());
            continue;
        }
        if let Some(parent) = resolved.parent() {
            let parent = parent.to_path_buf();
            if !dirs.contains(&parent) {
                dirs.push(parent);
            }
        }
    }

    // Deepest first, so a nested disc folder is pruned before its album folder is tested for emptiness.
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    for dir in &dirs {
        result.dirs_removed += prune_upwards(dir, &root, dry_run);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_inside_accepts_children_only() {
        let root = Path::new("/music");
        assert!(is_inside(Path::new("/music/Artist/Album/01.flac"), root));
        assert!(!is_inside(root, root));
        assert!(!is_inside(Path::new("/etc/passwd"), root));
        assert!(!is_inside(Path::new("/musicals/Artist/01.flac"), root));
        assert!(!is_inside(Path::new("/music/../etc/passwd"), root));
    }

    #[test]
    fn delete_files_removes_tracks_and_prunes_empty_folders() {
        let root = std::env::temp_dir().join(format!("dmp-delete-{}", std::process::id()));
        let album = root.join("Artist/Album");
        fs::create_dir_all(&album).unwrap();
        let track = album.join("01.flac");
        fs::write(&track, b"x").unwrap();

        let outside = std::env::temp_dir().join(format!("dmp-outside-{}.flac", std::process::id()));
        fs::write(&outside, b"x").unwrap();

        let paths = vec![
            track.to_string_lossy().to_string(),
            outside.to_string_lossy().to_string(),
        ];

        let dry = delete_files(&paths, &root.to_string_lossy(), true);
        assert_eq!(dry.files_removed, 1);
        assert_eq!(dry.skipped, vec![outside.to_string_lossy().to_string()]);
        assert!(track.exists(), "dry run must not delete anything");

        let real = delete_files(&paths, &root.to_string_lossy(), false);
        assert_eq!(real.files_removed, 1);
        assert_eq!(
            real.dirs_removed, 2,
            "Album and Artist should both be pruned"
        );
        assert!(!track.exists());
        assert!(!root.join("Artist").exists());
        assert!(root.exists(), "MUSIC_DIR itself is never removed");
        assert!(outside.exists(), "paths outside MUSIC_DIR are skipped");

        fs::remove_dir_all(&root).ok();
        fs::remove_file(&outside).ok();
    }

    // Regression: LocalReleaseTrack.filePath is stored RELATIVE to MUSIC_DIR in real data (e.g.
    // "Artist/Album/01.flac"), not absolute - the doc comment above claiming "absolute" was wrong.
    // A relative raw path used to resolve `parent()` against the PROCESS CWD instead of MUSIC_DIR,
    // fail to canonicalize, and get silently skipped - `--files` deleted nothing and re-indexing
    // brought every "deleted" release straight back.
    #[test]
    fn delete_files_resolves_a_relative_filepath_against_music_dir() {
        let root = std::env::temp_dir().join(format!("dmp-delete-relative-{}", std::process::id()));
        let album = root.join("Artist/Album");
        fs::create_dir_all(&album).unwrap();
        let track = album.join("01.flac");
        fs::write(&track, b"x").unwrap();

        let real = delete_files(
            &["Artist/Album/01.flac".to_string()],
            &root.to_string_lossy(),
            false,
        );
        assert_eq!(real.files_removed, 1);
        assert!(real.skipped.is_empty());
        assert!(!track.exists());

        fs::remove_dir_all(&root).ok();
    }

    fn temp_root(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("dmp-delete-release-{}-{}", std::process::id(), tag))
    }

    #[test]
    fn delete_release_folders_removes_a_folder_left_with_only_this_releases_audio() {
        let root = temp_root("exclusive");
        let album = root.join("Artist/Album");
        fs::create_dir_all(&album).unwrap();
        let track = album.join("01.flac");
        fs::write(&track, b"x").unwrap();
        fs::write(album.join("cover.jpg"), b"x").unwrap();

        let result = delete_release_folders(
            &[track.to_string_lossy().to_string()],
            &[album.to_string_lossy().to_string()],
            &root.to_string_lossy(),
            false,
        );

        assert_eq!(result.files_removed, 1);
        assert_eq!(result.dirs_removed, 1);
        assert!(
            !album.exists(),
            "cover.jpg must go with the rest of the folder"
        );
        assert!(
            root.join("Artist").exists(),
            "the artist folder is never this call's business"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_release_folders_keeps_a_folder_still_holding_another_releases_audio() {
        let root = temp_root("shared");
        let album = root.join("Artist/Compilation");
        fs::create_dir_all(&album).unwrap();
        let mine = album.join("01.flac");
        let theirs = album.join("02.flac");
        fs::write(&mine, b"x").unwrap();
        fs::write(&theirs, b"x").unwrap();

        let result = delete_release_folders(
            &[mine.to_string_lossy().to_string()],
            &[album.to_string_lossy().to_string()],
            &root.to_string_lossy(),
            false,
        );

        assert_eq!(result.files_removed, 1);
        assert_eq!(result.dirs_removed, 0);
        assert!(!mine.exists());
        assert!(theirs.exists(), "another release's audio must survive");
        assert!(album.exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_release_folders_folds_a_multi_disc_album_up_to_its_own_boundary_only() {
        let root = temp_root("box");
        let album = root.join("Artist/Box Set");
        let cd1 = album.join("CD1");
        let cd2 = album.join("CD2");
        fs::create_dir_all(&cd1).unwrap();
        fs::create_dir_all(&cd2).unwrap();
        let t1 = cd1.join("01.flac");
        let t2 = cd2.join("01.flac");
        fs::write(&t1, b"x").unwrap();
        fs::write(&t2, b"x").unwrap();

        // Mirrors how `release.rs` builds `folder_paths`: LocalRelease.folderPath (the album) plus
        // every LocalReleaseMember.folderPath (each disc).
        let result = delete_release_folders(
            &[
                t1.to_string_lossy().to_string(),
                t2.to_string_lossy().to_string(),
            ],
            &[
                album.to_string_lossy().to_string(),
                cd1.to_string_lossy().to_string(),
                cd2.to_string_lossy().to_string(),
            ],
            &root.to_string_lossy(),
            false,
        );

        assert_eq!(result.files_removed, 2);
        assert_eq!(
            result.dirs_removed, 3,
            "CD1, CD2 and the album folder each count as one folder removed"
        );
        assert!(
            !album.exists(),
            "the album folder becomes empty and is pruned too"
        );
        assert!(
            root.join("Artist").exists(),
            "the artist folder is never touched"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_release_folders_skips_paths_outside_music_dir() {
        let root = temp_root("outside");
        fs::create_dir_all(&root).unwrap();
        let outside =
            std::env::temp_dir().join(format!("dmp-release-outside-{}.flac", std::process::id()));
        fs::write(&outside, b"x").unwrap();

        let result = delete_release_folders(
            &[outside.to_string_lossy().to_string()],
            &[],
            &root.to_string_lossy(),
            false,
        );

        assert_eq!(result.files_removed, 0);
        assert_eq!(result.skipped, vec![outside.to_string_lossy().to_string()]);
        assert!(outside.exists());

        fs::remove_dir_all(&root).ok();
        fs::remove_file(&outside).ok();
    }

    #[test]
    fn delete_release_folders_dry_run_touches_nothing() {
        let root = temp_root("dry");
        let album = root.join("Artist/Album");
        fs::create_dir_all(&album).unwrap();
        let track = album.join("01.flac");
        fs::write(&track, b"x").unwrap();

        let result = delete_release_folders(
            &[track.to_string_lossy().to_string()],
            &[album.to_string_lossy().to_string()],
            &root.to_string_lossy(),
            true,
        );

        assert_eq!(result.files_removed, 1);
        assert_eq!(result.dirs_removed, 1);
        assert!(track.exists(), "dry run must not delete the file");
        assert!(album.exists(), "dry run must not delete the folder");

        fs::remove_dir_all(&root).ok();
    }

    // Same regression as delete_files_resolves_a_relative_filepath_against_music_dir, for the release
    // path: both track_paths (filePath) and release_dirs (folderPath) are relative to MUSIC_DIR in
    // real data.
    #[test]
    fn delete_release_folders_resolves_relative_paths_against_music_dir() {
        let root = temp_root("relative");
        let album = root.join("Artist/Album");
        fs::create_dir_all(&album).unwrap();
        let track = album.join("01.flac");
        fs::write(&track, b"x").unwrap();

        let result = delete_release_folders(
            &["Artist/Album/01.flac".to_string()],
            &["Artist/Album".to_string()],
            &root.to_string_lossy(),
            false,
        );

        assert_eq!(result.files_removed, 1);
        assert_eq!(result.dirs_removed, 1);
        assert!(result.skipped.is_empty());
        assert!(!album.exists());
        assert!(root.join("Artist").exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_release_folder_holding_unindexed_audio_is_kept() {
        let root = temp_root("unindexed");
        let album = root.join("Artist/Album");
        fs::create_dir_all(&album).unwrap();
        fs::write(album.join("01.flac"), b"x").unwrap();
        fs::write(album.join("cover.jpg"), b"x").unwrap();
        fs::write(album.join("bonus.wav"), b"x").unwrap();

        let result = delete_release_folders(
            &["Artist/Album/01.flac".to_string()],
            &["Artist/Album".to_string()],
            &root.to_string_lossy(),
            false,
        );
        assert_eq!(result.files_removed, 1);
        assert_eq!(result.dirs_removed, 0);
        assert!(album.join("bonus.wav").exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_release_folder_with_only_sidecars_left_is_removed() {
        let root = temp_root("sidecars");
        let album = root.join("Artist/Album");
        fs::create_dir_all(&album).unwrap();
        fs::write(album.join("01.flac"), b"x").unwrap();
        fs::write(album.join("cover.jpg"), b"x").unwrap();
        fs::write(album.join("rip.log"), b"x").unwrap();

        let result = delete_release_folders(
            &["Artist/Album/01.flac".to_string()],
            &["Artist/Album".to_string()],
            &root.to_string_lossy(),
            false,
        );
        assert_eq!(result.dirs_removed, 1);
        assert!(!album.exists());

        fs::remove_dir_all(&root).ok();
    }
}
