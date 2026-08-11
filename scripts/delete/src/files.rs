//! Physical audio-file removal for `--files`.
//!
//! Everything here is guarded by one rule: a path only gets deleted if it resolves *inside* the
//! configured `MUSIC_DIR`. The DB stores absolute `filePath`s written by a previous index run, so a
//! moved library, a symlinked folder, or a hand-edited row could otherwise point the delete at
//! anything on the host. Resolution goes through the parent directory (`canonical_parent`), so a
//! symlinked album folder that escapes the library is caught even though the file itself is real.

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

/// Resolved, in-library path for `raw`, or None when it does not exist, cannot be resolved, or falls
/// outside `music_root` (which must already be canonical).
pub fn resolve_in_library(raw: &str, music_root: &Path) -> Option<PathBuf> {
    let resolved = canonical_parent(Path::new(raw))?;
    is_inside(&resolved, music_root).then_some(resolved)
}

/// Removes every empty directory from `start` upward, stopping at (and never removing) `root`.
/// Returns how many directories were removed.
fn prune_upwards(start: &Path, root: &Path, dry_run: bool) -> usize {
    let mut removed = 0usize;
    let mut dir = start.to_path_buf();

    while is_inside(&dir, root) {
        let empty = fs::read_dir(&dir).map(|mut d| d.next().is_none()).unwrap_or(false);
        if !empty {
            break
        }
        if !dry_run && fs::remove_dir(&dir).is_err() {
            break
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

/// Deletes `paths` (absolute `LocalReleaseTrack.filePath` values) that live inside `music_dir`, then
/// prunes the directories they emptied. With `dry_run` nothing is touched - the counts describe what
/// would happen. `music_dir` is canonicalised once; if that fails, nothing is deleted.
pub fn delete_files(paths: &[String], music_dir: &str, dry_run: bool) -> FileDeletion {
    let Ok(root) = fs::canonicalize(music_dir) else {
        return FileDeletion {
            skipped: paths.to_vec(),
            ..Default::default()
        }
    };

    let mut result = FileDeletion::default();
    let mut dirs: Vec<PathBuf> = Vec::new();

    for raw in paths {
        let Some(resolved) = resolve_in_library(raw, &root) else {
            result.skipped.push(raw.clone());
            continue
        };
        if dry_run {
            result.files_removed += 1;
        }
        else if fs::remove_file(&resolved).is_ok() {
            result.files_removed += 1;
        }
        else {
            result.skipped.push(raw.clone());
            continue
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
        assert_eq!(real.dirs_removed, 2, "Album and Artist should both be pruned");
        assert!(!track.exists());
        assert!(!root.join("Artist").exists());
        assert!(root.exists(), "MUSIC_DIR itself is never removed");
        assert!(outside.exists(), "paths outside MUSIC_DIR are skipped");

        fs::remove_dir_all(&root).ok();
        fs::remove_file(&outside).ok();
    }
}
