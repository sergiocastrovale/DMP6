//! The scan pipeline: enumerate artists, walk their release folders, check every file.
//!
//! Deliberately **not** a global two-pass. Every folder-level check is local to one folder, so both
//! the aggregate and its attribution back onto individual files fit inside one folder's scope. That
//! keeps peak memory bounded by the largest single folder rather than by the library - which matters
//! because the container this runs in is capped at 2 GB, and holding a record per file for a
//! multi-million-file library would not fit.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use rayon::prelude::*;

use crate::audio::{self, is_audio_file};
use crate::checks::folder::{folder_reasons, FileFacts};
use crate::checks::{check_file, render_reasons, sanitize_cell, Reason, ReasonCode};
use crate::progress::Counters;
use crate::spool::Row;

/// Per-run tally of how many files each defect affected, merged on the main thread once per batch.
pub type CodeCounts = BTreeMap<ReasonCode, u64>;

/// Result of scanning one batch of artists.
pub struct BatchResult {
    pub rows: Vec<Row>,
    pub counts: CodeCounts,
}

/// Directory names that mark a disc subfolder rather than a separate release.
///
/// Mirrors `strip_disc_subfolder` in `scripts/index/src/db.rs`: the indexer groups a release by its
/// folder with these collapsed, so a multi-disc set is ONE release. Without this, every box set
/// would falsely report "multiple albums in one folder".
fn is_disc_subfolder(name: &str) -> bool {
    let n = name.trim().to_lowercase().replace([' ', '_', '-'], "");
    for prefix in ["cd", "disc", "disk"] {
        if let Some(rest) = n.strip_prefix(prefix) {
            if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
                return true;
            }
        }
    }
    false
}

/// Split a file into (release folder, name-within-release), both relative to the scan root.
///
/// A disc subfolder is collapsed into the release - matching how the indexer groups a multi-disc set
/// as one release - but it is kept on the *file* side as `CD1/01.mp3`. Dropping it entirely would
/// make the two rows for `Album/CD1/01.mp3` and `Album/CD2/01.mp3` identical in the report, leaving
/// the user unable to tell which file to fix.
fn split_release_path(file: &Path, root: &Path) -> (String, String) {
    let rel = file.strip_prefix(root).unwrap_or(file);
    let name = rel
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let dir = rel.parent().map(Path::to_path_buf).unwrap_or_default();

    let disc = dir
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| is_disc_subfolder(n));
    let (folder, file_label) = match disc {
        Some(disc_name) => {
            let parent = dir.parent().map(Path::to_path_buf).unwrap_or_default();
            (parent, format!("{disc_name}/{name}"))
        }
        None => (dir, name),
    };

    let folder_str = folder.to_string_lossy().replace('\\', "/");
    let folder_str = if folder_str.is_empty() {
        ".".to_string()
    } else {
        folder_str
    };
    (folder_str, file_label)
}

/// List the artist directories under the scan root, filtered and sorted.
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
        .filter(|n| crate::filter::matches_filter(n, from, to, only, exact))
        .collect();
    // Sorted case-insensitively so `last_artist` resume ordering is stable and matches the
    // comparison used when skipping.
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

/// Collect the audio files under one artist directory, grouped by release folder.
fn folders_for_artist(root: &Path, artist: &str) -> BTreeMap<String, Vec<(PathBuf, String)>> {
    let mut map: BTreeMap<String, Vec<(PathBuf, String)>> = BTreeMap::new();
    let dir = root.join(artist);
    for entry in walkdir::WalkDir::new(&dir)
        .follow_links(true)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_dir() {
            continue;
        }
        let path = entry.path();
        if !is_audio_file(path) {
            continue;
        }
        let (folder, label) = split_release_path(path, root);
        map.entry(folder)
            .or_default()
            .push((path.to_path_buf(), label));
    }
    // Sorted within a folder so ties and output order are deterministic across runs.
    for files in map.values_mut() {
        files.sort();
    }
    map
}

/// Scan one release folder: check every file, then attribute folder-level defects back to all of
/// them.
fn scan_folder(
    folder: &str,
    files: &[(PathBuf, String)],
    current_year: i32,
    counters: &Counters,
) -> (Vec<Row>, CodeCounts) {
    let mut per_file: Vec<(String, Vec<Reason>)> = Vec::with_capacity(files.len());
    let mut facts: Vec<FileFacts> = Vec::with_capacity(files.len());

    for (path, name) in files {
        let name = name.clone();
        counters.files.fetch_add(1, Ordering::Relaxed);

        match audio::read_tags_guarded(path) {
            Ok(snap) => {
                let reasons = check_file(&snap, current_year);
                facts.push(FileFacts {
                    file_name: name.clone(),
                    artist: snap.artist.clone(),
                    album_artist: snap.album_artist.clone(),
                    album: snap.album.clone(),
                    year: crate::checks::year::leading_year(
                        snap.dates
                            .recording
                            .as_deref()
                            .or(snap.dates.year.as_deref())
                            .unwrap_or(""),
                    ),
                });
                per_file.push((name, reasons));
            }
            Err(e) => {
                counters.unreadable.fetch_add(1, Ordering::Relaxed);
                let code = match e {
                    audio::ReadError::Panicked => ReasonCode::TagReadPanicked,
                    _ => ReasonCode::TagsUnreadable,
                };
                // No facts: an unreadable file contributes nothing to folder aggregates, since we
                // cannot know what it claims. Counting it would invent drift that may not exist.
                per_file.push((name, vec![Reason::new(code, sanitize_cell(&e.detail()))]));
            }
        }
    }

    let shared = folder_reasons(&facts);

    let mut rows = Vec::new();
    let mut counts: CodeCounts = BTreeMap::new();
    for (name, mut reasons) in per_file {
        reasons.extend(shared.iter().cloned());
        if reasons.is_empty() {
            continue;
        }
        for r in &reasons {
            *counts.entry(r.code).or_default() += 1;
        }
        counters.problem_files.fetch_add(1, Ordering::Relaxed);
        counters
            .problem_instances
            .fetch_add(reasons.len() as u64, Ordering::Relaxed);
        rows.push(Row {
            path: sanitize_cell(folder),
            file: sanitize_cell(&name),
            reason: render_reasons(reasons),
        });
    }
    counters.folders.fetch_add(1, Ordering::Relaxed);
    (rows, counts)
}

/// Scan one artist directory in parallel across its release folders.
pub fn scan_artist(
    root: &Path,
    artist: &str,
    current_year: i32,
    counters: &Arc<Counters>,
    limit_files: Option<usize>,
) -> BatchResult {
    let folders = folders_for_artist(root, artist);
    let mut entries: Vec<(String, Vec<(PathBuf, String)>)> = folders.into_iter().collect();

    if let Some(limit) = limit_files {
        let mut seen = 0usize;
        entries.retain(|(_, files)| {
            if seen >= limit {
                return false;
            }
            seen += files.len();
            true
        });
    }

    // collect() on an indexed parallel iterator preserves order, so rows come out folder-sorted
    // with no sort and no shared mutable Vec.
    let per_folder: Vec<(Vec<Row>, CodeCounts)> = entries
        .par_iter()
        .map(|(folder, files)| scan_folder(folder, files, current_year, counters))
        .collect();

    let mut rows = Vec::new();
    let mut counts: CodeCounts = BTreeMap::new();
    for (r, c) in per_folder {
        rows.extend(r);
        for (code, n) in c {
            *counts.entry(code).or_default() += n;
        }
    }
    BatchResult { rows, counts }
}

/// Merge per-batch code counts into a running total.
pub fn merge_counts(total: &mut CodeCounts, batch: &CodeCounts) {
    for (code, n) in batch {
        *total.entry(*code).or_default() += n;
    }
}

/// Convert counts into the Summary sheet's ordering: most severe first, then most frequent.
pub fn ranked_counts(counts: &CodeCounts) -> Vec<(ReasonCode, u64)> {
    let mut v: Vec<(ReasonCode, u64)> = counts.iter().map(|(c, n)| (*c, *n)).collect();
    v.sort_by(|a, b| {
        b.0.severity()
            .cmp(&a.0.severity())
            .then(b.1.cmp(&a.1))
            .then(a.0.cmp(&b.0))
    });
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disc_subfolders_are_recognised() {
        for name in ["CD1", "cd 2", "Disc 3", "disk04", "CD_1", "Disc-2"] {
            assert!(
                is_disc_subfolder(name),
                "should be a disc subfolder: {name}"
            );
        }
    }

    #[test]
    fn named_disc_subfolders_are_not_collapsed() {
        // The indexer does not collapse these either - they carry a title, so they are treated as
        // separate releases. Matching that exactly is what keeps the report truthful.
        for name in [
            "CD2 - Warmin' Up",
            "Disc 1 - Live",
            "Bonus",
            "Album",
            "1997 - Something",
        ] {
            assert!(
                !is_disc_subfolder(name),
                "should NOT be a disc subfolder: {name}"
            );
        }
    }

    #[test]
    fn a_disc_subfolder_collapses_into_the_release_but_stays_on_the_file() {
        let root = Path::new("/music");
        // Grouped as one release, so folder-level drift checks see the whole box set...
        assert_eq!(
            split_release_path(Path::new("/music/Artist/Album/CD1/01.mp3"), root),
            ("Artist/Album".into(), "CD1/01.mp3".into())
        );
        // ...but the disc stays on the file, or the two rows below would be identical and the
        // user could not tell which file to fix.
        assert_eq!(
            split_release_path(Path::new("/music/Artist/Album/CD2/01.mp3"), root),
            ("Artist/Album".into(), "CD2/01.mp3".into())
        );
    }

    #[test]
    fn an_ordinary_file_keeps_a_bare_name() {
        assert_eq!(
            split_release_path(Path::new("/music/Artist/Album/01.mp3"), Path::new("/music")),
            ("Artist/Album".into(), "01.mp3".into())
        );
    }

    #[test]
    fn a_named_disc_folder_stays_its_own_release() {
        assert_eq!(
            split_release_path(
                Path::new("/music/Artist/Album/CD2 - Live/01.mp3"),
                Path::new("/music")
            ),
            ("Artist/Album/CD2 - Live".into(), "01.mp3".into())
        );
    }

    #[test]
    fn a_root_level_file_gets_a_placeholder_folder() {
        assert_eq!(
            split_release_path(Path::new("/music/loose.mp3"), Path::new("/music")),
            (".".into(), "loose.mp3".into())
        );
    }

    #[test]
    fn ranked_counts_orders_by_severity_then_frequency() {
        let mut counts = CodeCounts::new();
        counts.insert(ReasonCode::FolderMultipleAlbums, 500); // Medium
        counts.insert(ReasonCode::ArtistMissing, 10); // Critical
        counts.insert(ReasonCode::TitleEmpty, 3); // Critical
        let ranked = ranked_counts(&counts);
        assert_eq!(
            ranked[0].0,
            ReasonCode::ArtistMissing,
            "critical must outrank frequency"
        );
        assert_eq!(ranked[1].0, ReasonCode::TitleEmpty);
        assert_eq!(ranked[2].0, ReasonCode::FolderMultipleAlbums);
    }

    #[test]
    fn merge_counts_accumulates() {
        let mut total = CodeCounts::new();
        let mut a = CodeCounts::new();
        a.insert(ReasonCode::ArtistMissing, 2);
        let mut b = CodeCounts::new();
        b.insert(ReasonCode::ArtistMissing, 3);
        b.insert(ReasonCode::TitleEmpty, 1);
        merge_counts(&mut total, &a);
        merge_counts(&mut total, &b);
        assert_eq!(total[&ReasonCode::ArtistMissing], 5);
        assert_eq!(total[&ReasonCode::TitleEmpty], 1);
    }
}
