//! Folder-level (cross-file) checks.
//!
//! These are the "inconsistency" defects: nothing is wrong with any single file, but the files
//! disagree with each other, and the indexer resolves that disagreement by majority vote with ties
//! broken by directory read order. A folder-level reason is attributed to **every** file in the
//! folder, because the fix is a folder-wide retag and the user needs to see which files are involved.

use std::collections::{BTreeMap, BTreeSet};

use super::{Reason, ReasonCode};

/// The per-file facts a folder check needs. Deliberately small - one of these exists per file in
/// the folder currently being scanned, and nothing larger is retained.
#[derive(Debug, Clone, Default)]
pub struct FileFacts {
    /// Kept for debugging and for future per-file folder diagnostics; the current folder checks
    /// only need the tag values.
    #[allow(dead_code)]
    pub file_name: String,
    /// `None` = tag absent. `Some("")` = tag present but empty. The distinction matters.
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    /// Normalized 4-digit year, when one could be read.
    pub year: Option<i32>,
}

/// Collapse a name the way a human would consider two spellings "the same artist".
fn loose_key(s: &str) -> String {
    s.trim().to_lowercase()
}

/// Drop a leading article so `"The Beatles"` and `"Beatles"` collapse together.
fn strip_the(s: &str) -> String {
    let lower = loose_key(s);
    lower
        .strip_prefix("the ")
        .map(str::to_string)
        .unwrap_or(lower)
}

/// Compute the folder-wide defects. Returned reasons apply to every file in the folder.
///
/// A folder holding a single audio file can never be internally inconsistent, so it short-circuits -
/// without that guard, every single-track folder in the library would report spurious drift.
pub fn folder_reasons(files: &[FileFacts]) -> Vec<Reason> {
    let mut out = Vec::new();
    if files.len() < 2 {
        return out;
    }

    let mut album_artists: BTreeMap<String, usize> = BTreeMap::new();
    let mut albums: BTreeMap<String, usize> = BTreeMap::new();
    let mut years: BTreeSet<i32> = BTreeSet::new();
    let mut album_present = 0usize;

    for f in files {
        if let Some(aa) = f.album_artist.as_deref() {
            if !aa.trim().is_empty() {
                *album_artists.entry(aa.to_string()).or_default() += 1;
            }
        }
        if let Some(al) = f.album.as_deref() {
            if !al.trim().is_empty() {
                *albums.entry(al.to_string()).or_default() += 1;
                album_present += 1;
            }
        }
        if let Some(y) = f.year {
            years.insert(y);
        }
    }

    if album_artists.len() > 1 {
        out.push(Reason::new(
            ReasonCode::FolderMultipleAlbumArtists,
            list_values(album_artists.keys()),
        ));
    }
    if albums.len() > 1 {
        out.push(Reason::new(
            ReasonCode::FolderMultipleAlbums,
            list_values(albums.keys()),
        ));
    }
    if years.len() > 1 {
        out.push(Reason::new(
            ReasonCode::FolderMultipleYears,
            years
                .iter()
                .map(i32::to_string)
                .collect::<Vec<_>>()
                .join(", "),
        ));
    }
    if album_present == 0 {
        out.push(Reason::bare(ReasonCode::FolderAlbumEmpty));
    }

    // Case and article drift across artist AND albumArtist values in the folder.
    let mut names: BTreeSet<String> = BTreeSet::new();
    for f in files {
        for v in [f.artist.as_deref(), f.album_artist.as_deref()]
            .into_iter()
            .flatten()
        {
            if !v.trim().is_empty() {
                names.insert(v.trim().to_string());
            }
        }
    }

    let mut by_case: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for n in &names {
        by_case.entry(loose_key(n)).or_default().insert(n.clone());
    }
    let case_drift: Vec<&BTreeSet<String>> = by_case.values().filter(|s| s.len() > 1).collect();
    if !case_drift.is_empty() {
        out.push(Reason::new(
            ReasonCode::FolderArtistCaseDrift,
            case_drift
                .iter()
                .map(|s| list_values(s.iter()))
                .collect::<Vec<_>>()
                .join(" | "),
        ));
    }

    // "The X" vs "X". Reported separately from case drift because it is the one the post-indexing
    // duplicate-artist audit structurally cannot catch: that rule strips non-alphanumerics and
    // lowercases, so "thebeatles" and "beatles" remain different keys forever.
    let mut by_article: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for n in &names {
        by_article
            .entry(strip_the(n))
            .or_default()
            .insert(n.clone());
    }
    let article_drift: Vec<&BTreeSet<String>> = by_article
        .values()
        .filter(|s| {
            // Only when the group genuinely mixes an article-prefixed spelling with a bare one;
            // a pure case-drift group is already reported above.
            s.len() > 1
                && s.iter()
                    .map(|v| loose_key(v))
                    .collect::<BTreeSet<_>>()
                    .len()
                    > 1
        })
        .collect();
    if !article_drift.is_empty() {
        out.push(Reason::new(
            ReasonCode::FolderArtistThePrefixDrift,
            article_drift
                .iter()
                .map(|s| list_values(s.iter()))
                .collect::<Vec<_>>()
                .join(" | "),
        ));
    }

    out
}

/// Join distinct values for the report, capped so a pathological folder cannot produce a
/// thousand-character cell.
fn list_values<'a>(vals: impl Iterator<Item = &'a String>) -> String {
    const MAX: usize = 4;
    let all: Vec<&String> = vals.collect();
    let shown: Vec<String> = all
        .iter()
        .take(MAX)
        .map(|v| format!("\"{}\"", super::sanitize_cell(v)))
        .collect();
    if all.len() > MAX {
        format!("{} and {} more", shown.join(", "), all.len() - MAX)
    } else {
        shown.join(", ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(album_artist: &str, album: &str, year: Option<i32>) -> FileFacts {
        FileFacts {
            file_name: "x.mp3".into(),
            artist: Some(album_artist.to_string()),
            album_artist: Some(album_artist.to_string()),
            album: Some(album.to_string()),
            year,
        }
    }

    fn codes(rs: &[Reason]) -> Vec<ReasonCode> {
        rs.iter().map(|r| r.code).collect()
    }

    #[test]
    fn a_consistent_folder_reports_nothing() {
        let files = vec![
            f("Radiohead", "OK Computer", Some(1997)),
            f("Radiohead", "OK Computer", Some(1997)),
        ];
        assert!(folder_reasons(&files).is_empty());
    }

    #[test]
    fn a_single_file_folder_never_reports_drift() {
        // Guard against N=1 false positives - a lone file cannot disagree with anything.
        let files = vec![f("Radiohead", "OK Computer", Some(1997))];
        assert!(folder_reasons(&files).is_empty());
    }

    #[test]
    fn multiple_album_artists_are_reported_with_both_values() {
        let files = vec![
            f("Radiohead", "OK Computer", Some(1997)),
            f("Portishead", "OK Computer", Some(1997)),
        ];
        let rs = folder_reasons(&files);
        assert!(codes(&rs).contains(&ReasonCode::FolderMultipleAlbumArtists));
        let detail = &rs
            .iter()
            .find(|r| r.code == ReasonCode::FolderMultipleAlbumArtists)
            .unwrap()
            .detail;
        assert!(detail.contains("Radiohead") && detail.contains("Portishead"));
    }

    #[test]
    fn multiple_albums_and_years_are_reported() {
        let files = vec![
            f("Radiohead", "OK Computer", Some(1997)),
            f("Radiohead", "Greatest Hits", Some(2008)),
        ];
        let got = codes(&folder_reasons(&files));
        assert!(got.contains(&ReasonCode::FolderMultipleAlbums));
        assert!(got.contains(&ReasonCode::FolderMultipleYears));
    }

    #[test]
    fn an_entirely_album_less_folder_reports_once_and_not_as_drift() {
        let files = vec![
            f("Radiohead", "", Some(1997)),
            f("Radiohead", "", Some(1997)),
        ];
        let got = codes(&folder_reasons(&files));
        assert!(got.contains(&ReasonCode::FolderAlbumEmpty));
        assert!(
            !got.contains(&ReasonCode::FolderMultipleAlbums),
            "empty is not multiple"
        );
    }

    #[test]
    fn case_drift_is_reported_without_the_article_reason() {
        let files = vec![
            f("The Beatles", "Abbey Road", Some(1969)),
            f("THE BEATLES", "Abbey Road", Some(1969)),
        ];
        let got = codes(&folder_reasons(&files));
        assert!(got.contains(&ReasonCode::FolderArtistCaseDrift));
        assert!(
            !got.contains(&ReasonCode::FolderArtistThePrefixDrift),
            "same name in two cases is not article drift"
        );
    }

    #[test]
    fn article_drift_is_reported_because_the_audit_cannot_catch_it() {
        // audit/src/duplicates.rs normalizes to alphanumerics-lowercased, so "thebeatles" and
        // "beatles" stay distinct forever. This check is the only thing that surfaces it.
        let files = vec![
            f("The Beatles", "Abbey Road", Some(1969)),
            f("Beatles", "Abbey Road", Some(1969)),
        ];
        assert!(codes(&folder_reasons(&files)).contains(&ReasonCode::FolderArtistThePrefixDrift));
    }

    #[test]
    fn missing_years_on_some_files_are_not_drift() {
        let files = vec![
            f("Radiohead", "OK Computer", Some(1997)),
            f("Radiohead", "OK Computer", None),
        ];
        assert!(!codes(&folder_reasons(&files)).contains(&ReasonCode::FolderMultipleYears));
    }

    #[test]
    fn value_lists_are_capped() {
        let files: Vec<FileFacts> = (0..10)
            .map(|i| f(&format!("Artist {i}"), "Comp", Some(2000)))
            .collect();
        let rs = folder_reasons(&files);
        let detail = &rs
            .iter()
            .find(|r| r.code == ReasonCode::FolderMultipleAlbumArtists)
            .unwrap()
            .detail;
        assert!(detail.contains("and 6 more"), "got: {detail}");
    }
}
