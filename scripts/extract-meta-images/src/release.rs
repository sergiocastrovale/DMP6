//! Library traversal: artist directories, and the release folders inside them.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use common::filters::matches_filter;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "opus", "aac", "ogg", "flac"];

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_string_lossy().to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Directory names that mark a disc subfolder rather than a release of their own.
///
/// Mirrors `strip_disc_subfolder` in `scripts/index/src/db.rs`: the indexer groups a multi-disc set
/// as ONE release keyed by the parent folder, so a cover written per disc folder would be a cover
/// the indexer never looks for.
fn is_disc_subfolder(name: &str) -> bool {
    let n = name.trim().to_lowercase().replace([' ', '_', '-'], "");
    ["cd", "disc", "disk"].iter().any(|prefix| {
        n.strip_prefix(prefix)
            .map(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false)
    })
}

/// The artist directories under the library root, filtered and sorted.
pub fn list_artist_dirs(
    root: &Path,
    from: &str,
    to: &str,
    only: &str,
    exact: bool,
) -> std::io::Result<Vec<String>> {
    let mut names: Vec<String> = std::fs::read_dir(root)?
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| !n.starts_with('.'))
        .filter(|n| matches_filter(n, from, to, only, exact))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

/// The release folders under one artist directory: every folder holding audio, with disc
/// subfolders collapsed into their parent. Sorted, deduplicated.
pub fn release_dirs_for_artist(root: &Path, artist: &str) -> Vec<PathBuf> {
    let mut releases: BTreeSet<PathBuf> = BTreeSet::new();

    for entry in walkdir::WalkDir::new(root.join(artist))
        .follow_links(true)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_dir() || !is_audio_file(entry.path()) {
            continue;
        }
        let Some(dir) = entry.path().parent() else {
            continue;
        };
        let is_disc = dir
            .file_name()
            .and_then(|n| n.to_str())
            .map(is_disc_subfolder)
            .unwrap_or(false);
        let release = if is_disc {
            dir.parent().unwrap_or(dir)
        } else {
            dir
        };
        releases.insert(release.to_path_buf());
    }

    releases.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disc_subfolders_are_recognised() {
        for name in ["CD1", "cd 2", "Disc 3", "disk_4", "CD-10"] {
            assert!(is_disc_subfolder(name), "{name} should be a disc folder");
        }
    }

    #[test]
    fn a_named_disc_folder_is_not_a_disc_subfolder() {
        // "CD2 - Warmin' Up" names its own content - collapsing it would attribute one disc's art
        // to a release the indexer treats separately.
        for name in ["CD2 - Warmin' Up", "Bonus", "Disc of Wonders", "Live"] {
            assert!(!is_disc_subfolder(name), "{name} should not be a disc folder");
        }
    }

    #[test]
    fn audio_extensions_are_matched_case_insensitively() {
        assert!(is_audio_file(Path::new("a/01.FLAC")));
        assert!(is_audio_file(Path::new("a/01.mp3")));
        assert!(!is_audio_file(Path::new("a/cover.jpg")));
        assert!(!is_audio_file(Path::new("a/notes")));
    }
}
