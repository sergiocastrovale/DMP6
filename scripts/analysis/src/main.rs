use chrono::Local;
use clap::Parser;
use html_escape::encode_text;
use lofty::config::ParseOptions;
use lofty::prelude::*;
use lofty::probe::Probe;
use rayon::prelude::*;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;
use walkdir::WalkDir;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(name = "analysis", about = "Scan audio files for metadata issues")]
struct Args {
    /// Root directory to scan
    #[arg()]
    scan_path: String,

    /// UNC prefix for Windows links (e.g. \\\\minibrain\\test)
    #[arg(long, default_value = "")]
    unc_prefix: String,

    /// Output directory for the HTML report (relative or absolute)
    #[arg(long, default_value = "../../reports")]
    output_dir: String,

    /// Limit scan to the first N audio files (0 = no limit)
    #[arg(long, default_value = "0")]
    limit: usize,

    /// Filter: only scan folders starting from this prefix (case insensitive)
    #[arg(long, default_value = "")]
    from: String,

    /// Filter: only scan folders up to this prefix (case insensitive, inclusive of prefix)
    #[arg(long, default_value = "")]
    to: String,

    /// Filter: only scan folders starting with this prefix (case insensitive)
    #[arg(long, default_value = "")]
    only: String,

    /// Move each file with issues into a __QUARANTINE subfolder of the scan root, preserving the relative path
    #[arg(long)]
    quarantine: bool,

    /// Dry run of --quarantine: print what would be moved without touching the filesystem
    #[arg(long)]
    quarantine_dry: bool,

    /// Move all files from __QUARANTINE back to their original locations (reverses --quarantine)
    #[arg(long)]
    end_quarantine: bool,

    /// Skip report generation entirely
    #[arg(long)]
    no_report: bool,

    /// Only generate critical.html + index.html
    #[arg(long)]
    only_critical: bool,

    /// Only generate mb.html + index.html
    #[arg(long)]
    only_mb: bool,

    /// Only generate discogs.html + index.html
    #[arg(long)]
    only_discogs: bool,

    /// Only generate issues.html + index.html
    #[arg(long)]
    only_issues: bool,

    /// Only generate ids.html + index.html
    #[arg(long)]
    only_ids: bool,

    /// Only generate other.html + index.html
    #[arg(long)]
    only_other: bool,

    /// Use beets to auto-fix missing metadata on files with issues (requires beet installed)
    #[arg(long)]
    autofix: bool,

    /// Dry run of --autofix: show what beets would tag without writing anything
    #[arg(long)]
    autofix_dry: bool,
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// Which pages to generate in the report.
/// Note: issues.html + index.html are always generated.
struct PageFlags {
    critical: bool,
    mb: bool,
    discogs: bool,
    ids: bool,
    other: bool,
}

/// Badge counts for the navigation bar.
struct NavCounts {
    issues: usize,
    critical: usize,
    mb: usize,
    discogs: usize,
    ids: usize,
    other: usize,
    // Fixed counts (for autofix delta display)
    critical_matched: usize,
    mb_matched: usize,
    discogs_matched: usize,
    ids_matched: usize,
    other_matched: usize,
}

#[derive(Debug, Clone)]
struct FileIssue {
    path: PathBuf,
    file_size: u64,
    // Missing field flags — true means MISSING / BAD
    // Critical
    missing_artist: bool,
    missing_title: bool,
    missing_year: bool,
    // MusicBrainz
    missing_mb_artist_id: bool,
    missing_mb_track_id: bool,
    missing_mb_album_id: bool,
    // IDs
    missing_acoustic_id: bool,
    missing_songkong_id: bool,
    missing_bandcamp: bool,
    missing_wikipedia_artist: bool,
    // Discogs
    missing_discogs_artist: bool,
    missing_discogs_release: bool,
    // Other
    missing_genre: bool,
    missing_bpm: bool,
    missing_mood: bool,
    missing_album_art: bool,
    // Inconsistencies
    invalid_year: Option<String>,    // the bad value
    blank_artist: bool,
    blank_title: bool,
    blank_year: bool,
    blank_genre: bool,
}

/// A single field-level change made by beets autofix.
#[derive(Debug, Clone)]
struct FieldMatch {
    field: &'static str,       // e.g. "Artist", "Discogs Artist", "MB Track ID"
    old_display: String,       // "Missing", "(blank)", or the invalid value
    new_value: String,         // Actual new tag value written by beets
    category: &'static str,   // "critical", "mb", "discogs", "ids", "other"
}

/// Per-file collection of field-level diffs produced by autofix.
type MatchDiffs = HashMap<PathBuf, Vec<FieldMatch>>;

/// Per-file skip reasons: beets ran but found no confident match.
/// Key = file path, value = human-readable reason extracted from beets output.
type SkippedFiles = HashMap<PathBuf, String>;

/// Fix status attached to each file entry in artist groups.
#[derive(Debug, Clone)]
enum FileFixStatus {
    NoAutofix,           // autofix didn't run
    Matched,               // all issues for this field were resolved
    Skipped(String),     // beets attempted but found no confident match
}

impl FileIssue {
    fn has_critical(&self) -> bool {
        self.missing_artist
            || self.missing_title
            || self.missing_year
            || self.invalid_year.is_some()
            || self.blank_artist
            || self.blank_title
            || self.blank_year
    }
    fn has_mb(&self) -> bool {
        self.missing_mb_artist_id
            || self.missing_mb_track_id
            || self.missing_mb_album_id
    }
    fn has_discogs(&self) -> bool {
        self.missing_discogs_artist || self.missing_discogs_release
    }
    fn has_ids(&self) -> bool {
        self.missing_acoustic_id
            || self.missing_songkong_id
            || self.missing_bandcamp
            || self.missing_wikipedia_artist
    }
    fn has_other(&self) -> bool {
        self.missing_genre
            || self.missing_bpm
            || self.missing_mood
            || self.missing_album_art
            || self.blank_genre
    }
    fn has_any_issue(&self) -> bool {
        self.has_critical()
            || self.has_mb()
            || self.has_discogs()
            || self.has_ids()
            || self.has_other()
    }
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

/// Check if a tag with any of the given keys exists and is non-empty.
fn has_tag(tags: &HashMap<String, String>, keys: &[&str]) -> bool {
    keys.iter().any(|k| {
        tags.get(&k.to_uppercase())
            .map_or(false, |v| !v.trim().is_empty())
    })
}

/// Get the value of the first matching tag key (case-insensitive).
fn get_tag(tags: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(v) = tags.get(&k.to_uppercase()) {
            if !v.trim().is_empty() {
                return Some(v.clone());
            }
        }
    }
    None
}

/// Check if the tag exists as a key (even if blank).
fn tag_key_exists(tags: &HashMap<String, String>, keys: &[&str]) -> bool {
    keys.iter().any(|k| tags.contains_key(&k.to_uppercase()))
}

/// Returns true if any key matching the prefix exists with a non-empty value.
fn has_tag_prefix(tags: &HashMap<String, String>, prefix: &str) -> bool {
    let p = prefix.to_uppercase();
    tags.iter()
        .any(|(k, v)| k.starts_with(&p) && !v.trim().is_empty())
}

/// Collect all tags from all tag containers in a file into a single HashMap.
/// Keys are uppercased for uniform lookup.
fn collect_tags(tagged_file: &lofty::file::TaggedFile) -> HashMap<String, String> {
    let mut map = HashMap::new();

    for tag in tagged_file.tags() {
        // Standard items
        if let Some(v) = tag.artist() {
            map.entry("ARTIST".to_string())
                .or_insert_with(|| v.to_string());
        }
        if let Some(v) = tag.title() {
            map.entry("TITLE".to_string())
                .or_insert_with(|| v.to_string());
        }
        if let Some(v) = tag.year() {
            map.entry("YEAR".to_string())
                .or_insert_with(|| v.to_string());
        }
        if let Some(v) = tag.genre() {
            map.entry("GENRE".to_string())
                .or_insert_with(|| v.to_string());
        }

        // All custom / raw items
        for item in tag.items() {
            let key = match item.key() {
                lofty::tag::ItemKey::Unknown(s) => s.to_uppercase(),
                other => {
                    let mut k = format!("{:?}", other);
                    k.make_ascii_uppercase();
                    k
                }
            };
            if let lofty::tag::ItemValue::Text(val) = item.value() {
                map.entry(key).or_insert_with(|| val.clone());
            }
        }
    }

    map
}

// ---------------------------------------------------------------------------
// Scan a single file
// ---------------------------------------------------------------------------

fn scan_file(path: &Path) -> Result<(FileIssue, Vec<String>), String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let file_size = meta.len();

    let parse_opts = ParseOptions::new().read_properties(false);
    let tagged_file = match Probe::open(path).map_err(|e| e.to_string())?.options(parse_opts).read() {
        Ok(f) => f,
        Err(e) => return Err(e.to_string()),
    };

    let has_art = tagged_file
        .tags()
        .iter()
        .any(|t| t.pictures().iter().next().is_some());

    let tags = collect_tags(&tagged_file);

    // --- Critical ---
    let missing_artist = !has_tag(&tags, &["ARTIST"]);
    let missing_title = !has_tag(&tags, &["TITLE"]);
    let missing_year = !has_tag(&tags, &["YEAR"]);

    // --- MusicBrainz ---
    let missing_mb_artist_id = !has_tag(
        &tags,
        &["MUSICBRAINZ ARTIST ID", "MUSICBRAINZ_ARTISTID", "MUSICBRAINZARTISTID"],
    );
    let missing_mb_track_id = !has_tag(
        &tags,
        &[
            "MUSICBRAINZ RELEASE TRACK ID",
            "MUSICBRAINZ_TRACKID",
            "MUSICBRAINZTRACKID",
            "MUSICBRAINZ_RELEASETRACKID",
        ],
    );
    let missing_mb_album_id = !has_tag(
        &tags,
        &["MUSICBRAINZ ALBUM ID", "MUSICBRAINZ_ALBUMID", "MUSICBRAINZALBUMID", "MUSICBRAINZRELEASEID"],
    );

    // --- IDs ---
    let missing_acoustic_id = !has_tag(&tags, &["ACOUSTIC_ID", "ACOUSTIC ID", "ACOUSTID_ID", "ACOUSTID ID"]);
    let missing_songkong_id = !has_tag(&tags, &["SONGKONG_ID", "SONGKONGID"]);
    let missing_bandcamp =
        !has_tag(&tags, &["URL_BANDCAMP_ARTIST_SITE", "WWW BANDCAMP_ARTIST"]);
    let missing_wikipedia_artist = !has_tag(&tags, &["WWW WIKIPEDIA_ARTIST"]);

    // --- Discogs ---
    let missing_discogs_artist =
        !has_tag(&tags, &["URL_DISCOGS_ARTIST_SITE", "WWW DISCOGS_ARTIST"]);
    let missing_discogs_release =
        !has_tag(&tags, &["URL_DISCOGS_RELEASE_SITE", "WWW DISCOGS_RELEASE"]);

    // --- Other ---
    let missing_genre = !has_tag(&tags, &["GENRE"]);
    let missing_bpm = !has_tag(&tags, &["BPM"]);
    let missing_mood = !has_tag_prefix(&tags, "MOOD_");
    let missing_album_art = !has_art;

    // --- Inconsistency: blank fields ---
    let blank_artist =
        tag_key_exists(&tags, &["ARTIST"]) && !has_tag(&tags, &["ARTIST"]);
    let blank_title =
        tag_key_exists(&tags, &["TITLE"]) && !has_tag(&tags, &["TITLE"]);
    let blank_year =
        tag_key_exists(&tags, &["YEAR"]) && !has_tag(&tags, &["YEAR"]);
    let blank_genre =
        tag_key_exists(&tags, &["GENRE"]) && !has_tag(&tags, &["GENRE"]);

    // --- Inconsistency: invalid year ---
    let year_value = get_tag(&tags, &["YEAR"]);
    let invalid_year = year_value.as_ref().and_then(|y| {
        let trimmed = y.trim();
        match trimmed.parse::<i32>() {
            Ok(n) if n <= 0 || n >= 2030 => Some(trimmed.to_string()),
            Err(_) => Some(trimmed.to_string()),
            _ => None,
        }
    });

    let tag_keys: Vec<String> = tags.keys().cloned().collect();
    Ok((FileIssue {
        path: path.to_path_buf(),
        file_size,
        missing_artist,
        missing_title,
        missing_year,
        missing_mb_artist_id,
        missing_mb_track_id,
        missing_mb_album_id,
        missing_acoustic_id,
        missing_songkong_id,
        missing_bandcamp,
        missing_discogs_artist,
        missing_discogs_release,
        missing_wikipedia_artist,
        missing_genre,
        missing_bpm,
        missing_mood,
        missing_album_art,
        invalid_year,
        blank_artist,
        blank_title,
        blank_year,
        blank_genre,
    }, tag_keys))
}


// ---------------------------------------------------------------------------
// Path formatting helpers
// ---------------------------------------------------------------------------

/// Extract the first folder after the scan root (e.g., "Radiohead" from "/mnt/c/__DMP/Radiohead/...")
fn get_artist_folder(path: &Path, scan_root: &str) -> String {
    let path_str = path.to_string_lossy();
    let relative = path_str
        .strip_prefix(scan_root)
        .unwrap_or(&path_str)
        .trim_start_matches('/');

    relative
        .split('/')
        .next()
        .unwrap_or("")
        .to_string()
}

/// Get the path relative to the scan root (e.g., "Radiohead/OK Computer/01 Airbag.flac")
fn relative_path(path: &Path, scan_root: &str) -> String {
    let path_str = path.to_string_lossy();
    path_str
        .strip_prefix(scan_root)
        .unwrap_or(&path_str)
        .trim_start_matches('/')
        .to_string()
}

// ---------------------------------------------------------------------------
// Human-readable file size
// ---------------------------------------------------------------------------

fn human_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;
    const TB: u64 = 1024 * GB;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

// ---------------------------------------------------------------------------
// Report: shared CSS
// ---------------------------------------------------------------------------

const CSS: &str = r#":root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #242836;
    --border: #2e3348;
    --text: #e2e4ed;
    --text-dim: #8b8fa3;
    --accent: #6c7ee1;
    --accent-dim: #4a5699;
    --red: #e5534b;
    --green: #57ab5a;
    --orange: #daaa3f;
    --blue: #539bf5;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    padding: 24px;
}
.container { max-width: 100%; margin: 0 auto; }
h1 {
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 8px;
    color: var(--text);
}
.subtitle {
    color: var(--text-dim);
    margin-bottom: 12px;
    font-size: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.subtitle .meta {
    color: var(--text-dim);
    font-size: 13px;
}

/* Navigation */
.nav-bar {
    display: flex;
    border-bottom: 2px solid var(--border);
    margin-bottom: 24px;
    gap: 0;
}
.nav-tab {
    padding: 10px 20px;
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    transition: all 0.15s;
}
.nav-tab:hover { color: var(--text); }
.nav-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
}
.nav-tab .badge {
    background: var(--surface2);
    color: var(--text-dim);
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 11px;
    margin-left: 6px;
}
.nav-tab.active .badge {
    background: var(--accent-dim);
    color: #fff;
}

/* Stats cards */
.stats-container {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 24px;
}
.stats-group { display: flex; gap: 12px; flex-wrap: wrap; }
.stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    min-width: 140px;
}
.stat-card .label {
    color: var(--text-dim);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.stat-card .value { font-size: 22px; font-weight: 700; margin-top: 4px; }
.stat-card .value.ok { color: var(--green); }
.stat-card .value.fail { color: var(--red); }
.stat-card .value.warn { color: var(--orange); }
.stat-card .value.info { color: var(--blue); }

/* Tables */
.search-box { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.search-box input {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 6px 12px;
    font-size: 13px;
    width: 260px;
    outline: none;
}
.search-box input:focus { border-color: var(--accent); }
.table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
    background: var(--surface);
    color: var(--text-dim);
    font-weight: 600;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.5px;
    padding: 10px 12px;
    text-align: left;
    position: sticky;
    top: 0;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    cursor: pointer;
}
th:hover { color: var(--text); }
td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
}
td:first-child {
    max-width: 600px;
    overflow: hidden;
    text-overflow: ellipsis;
}
td:not(:first-child) {
    text-align: center;
    min-width: 90px;
}
th:not(:first-child) {
    text-align: center;
}
tr:hover td { background: var(--surface); }

/* Icons */
.miss { color: var(--red); font-weight: 700; font-size: 15px; }
.warn { color: var(--orange); font-weight: 700; font-size: 15px; }
.unknown { color: var(--orange); font-weight: 700; font-size: 15px; }
.ok { color: var(--green); font-size: 15px; }
.empty-state {
    text-align: center;
    padding: 48px;
    color: var(--text-dim);
    font-size: 15px;
}

/* Category breakdown on index */
.breakdown { margin-top: 24px; }
.breakdown h2 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--text);
}
.breakdown td { padding: 8px 16px; }
.breakdown a { color: var(--accent); text-decoration: none; }
.breakdown a:hover { text-decoration: underline; }

/* Subtab bar (data pages) */
.subtab-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    flex-wrap: wrap;
}
.subtab {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
}
.subtab:hover { color: var(--text); border-color: var(--accent-dim); }
.subtab.active { background: var(--accent-dim); border-color: var(--accent); color: #fff; }
.subtab-count {
    background: rgba(0,0,0,0.25);
    border-radius: 10px;
    padding: 1px 6px;
    font-size: 11px;
}
.panel.hidden { display: none; }
.artist-list { display: flex; flex-direction: column; gap: 6px; }
.artist-group {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
}
.artist-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--surface);
    cursor: pointer;
    user-select: none;
}
.artist-header:hover { background: var(--surface2); }
.artist-name { font-weight: 600; color: var(--text); flex: 1; font-size: 13px; }
.file-count { color: var(--text-dim); font-size: 12px; }
.arrow { color: var(--text-dim); font-size: 11px; display: inline-block; transition: transform 0.15s; }
.artist-group.collapsed .arrow { transform: rotate(-90deg); }
.file-list { list-style: none; border-top: 1px solid var(--border); }
.artist-group.collapsed .file-list { display: none; }
.file-item {
    padding: 6px 14px 6px 36px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.file-item:last-child { border-bottom: none; }
.file-item:hover { background: var(--surface); color: var(--text); }
.annot { color: var(--orange); font-size: 11px; margin-left: 8px; }
.empty-panel { text-align: center; padding: 48px; color: var(--text-dim); font-size: 15px; }

/* Pagination */
.pagination { display: flex; justify-content: center; align-items: center; gap: 4px; margin: 16px 0; }
.pagination a, .pagination span { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; padding: 4px 8px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600; color: var(--text-dim); border: 1px solid var(--border); }
.pagination a:hover { background: var(--surface2); color: var(--text); border-color: var(--accent-dim); }
.pagination .active { background: var(--accent-dim); border-color: var(--accent); color: #fff; }
.pagination .disabled { opacity: 0.3; pointer-events: none; border-color: transparent; }

/* Autofix: matched file styling */
.file-item { position: relative; }
.file-item.matched { text-decoration: line-through; opacity: 0.5; }
.file-item.matched:hover { opacity: 0.8; }
.match-check { color: var(--green); font-size: 13px; margin-left: 8px; }
.match-delta { color: var(--green); font-size: 10px; margin-left: 4px; }
.match-popover { display:none; position:fixed; z-index:1000; background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:12px 16px; font-size:12px; line-height:1.6; max-width:500px; white-space:normal; box-shadow:0 4px 12px rgba(0,0,0,0.4); pointer-events:none; }
.pop-title { font-weight:600; color:var(--text); margin-bottom:6px; }
.pop-old { text-decoration:line-through; color:var(--red); }
.pop-new { color:var(--green); }
.pop-arrow { color:var(--text-dim); margin:0 6px; }"#;

// ---------------------------------------------------------------------------
// Report: shared JS
// ---------------------------------------------------------------------------

const JS: &str = r#"/* autofix: popover show/hide */
function showMatchInfo(el) { var p=el.parentElement.querySelector('.match-popover'); if(!p) return; var r=el.getBoundingClientRect(); p.style.left=r.left+'px'; p.style.top=(r.bottom+6)+'px'; p.style.display='block'; }
function hideMatchInfo(el) { var p=el.parentElement.querySelector('.match-popover'); if(p) p.style.display='none'; }
/* issues.html: flat table search */
function filterTable(input) {
    var filter = input.value.toLowerCase();
    var rows = document.querySelectorAll('table tbody tr');
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.querySelector('.empty-state')) continue;
        row.style.display = row.textContent.toLowerCase().indexOf(filter) !== -1 ? '' : 'none';
    }
}
/* data pages: subtab switching */
function switchSubtab(btn) {
    var tabs = btn.parentNode.querySelectorAll('.subtab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
    btn.classList.add('active');
    var panels = document.querySelectorAll('.panel');
    var target = btn.dataset.panel;
    for (var i = 0; i < panels.length; i++) {
        panels[i].classList.toggle('hidden', panels[i].id !== target);
    }
}
/* data pages: collapse/expand artist group */
function toggleArtist(header) {
    header.parentNode.classList.toggle('collapsed');
}
/* data pages: filter within active panel */
function filterGroups(input) {
    var filter = input.value.toLowerCase().trim();
    var panel = document.querySelector('.panel:not(.hidden)');
    if (!panel) return;
    var groups = panel.querySelectorAll('.artist-group');
    for (var i = 0; i < groups.length; i++) {
        var group = groups[i];
        var nameEl = group.querySelector('.artist-name');
        var artistMatch = filter === '' || (nameEl && nameEl.textContent.toLowerCase().indexOf(filter) !== -1);
        var items = group.querySelectorAll('.file-item');
        var visible = 0;
        for (var j = 0; j < items.length; j++) {
            var show = filter === '' || artistMatch || items[j].textContent.toLowerCase().indexOf(filter) !== -1;
            items[j].style.display = show ? '' : 'none';
            if (show) visible++;
        }
        group.style.display = (filter === '' || visible > 0) ? '' : 'none';
        if (filter !== '' && visible > 0) group.classList.remove('collapsed');
    }
}
/* issues.html: sortable columns */
document.addEventListener('DOMContentLoaded', function() {
    var headers = document.querySelectorAll('th[data-sort]');
    for (var h = 0; h < headers.length; h++) {
        (function(th) {
            th.addEventListener('click', function() {
                var table = th.closest('table');
                var tbody = table.querySelector('tbody');
                var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
                var idx = parseInt(th.dataset.sort);
                var asc = th.dataset.dir !== 'asc';
                th.dataset.dir = asc ? 'asc' : 'desc';
                var allTh = th.closest('thead').querySelectorAll('th');
                for (var i = 0; i < allTh.length; i++) {
                    if (allTh[i] !== th) delete allTh[i].dataset.dir;
                }
                rows.sort(function(a, b) {
                    var av = (a.cells[idx] && a.cells[idx].textContent.trim()) || '';
                    var bv = (b.cells[idx] && b.cells[idx].textContent.trim()) || '';
                    return asc ? av.localeCompare(bv) : bv.localeCompare(av);
                });
                for (var i = 0; i < rows.length; i++) tbody.appendChild(rows[i]);
            });
        })(headers[h]);
    }
});
"#;

// ---------------------------------------------------------------------------
// Report: artist-grouped data helpers
// ---------------------------------------------------------------------------

/// BTreeMap<artist_folder -> Vec<(relative_path, optional_annotation, fix_status)>>
type ArtistGroups = BTreeMap<String, Vec<(String, Option<String>, FileFixStatus)>>;

const ARTISTS_PER_PAGE: usize = 20;

/// Build an artist-grouped list of files that satisfy `predicate`.
/// Files within each group are sorted by relative path.
/// When `diffs` and `field_name` are provided, each entry gets a fix_status based on whether
/// the autofix diffs contain a FieldMatch matching `field_name` for that file.
fn build_groups(
    issues: &[FileIssue],
    scan_root: &str,
    predicate: impl Fn(&FileIssue) -> bool,
    annotate: impl Fn(&FileIssue) -> Option<String>,
    diffs: Option<&MatchDiffs>,
    skipped_files: Option<&SkippedFiles>,
    field_name: Option<&str>,
) -> ArtistGroups {
    let mut groups: ArtistGroups = BTreeMap::new();
    for issue in issues {
        if !predicate(issue) { continue; }
        let artist = get_artist_folder(&issue.path, scan_root);
        let rel    = relative_path(&issue.path, scan_root);
        let ann    = annotate(issue);
        let fix_status = if diffs.is_none() && skipped_files.is_none() {
            FileFixStatus::NoAutofix
        } else if let Some(sf) = skipped_files {
            if let Some(reason) = sf.get(&issue.path) {
                FileFixStatus::Skipped(reason.clone())
            } else if let (Some(d), Some(fname)) = (diffs, field_name) {
                if d.get(&issue.path).map_or(false, |fixes| fixes.iter().any(|fix| fix.field == fname)) {
                    FileFixStatus::Matched
                } else {
                    FileFixStatus::NoAutofix
                }
            } else {
                FileFixStatus::NoAutofix
            }
        } else if let (Some(d), Some(fname)) = (diffs, field_name) {
            if d.get(&issue.path).map_or(false, |fixes| fixes.iter().any(|fix| fix.field == fname)) {
                FileFixStatus::Matched
            } else {
                FileFixStatus::NoAutofix
            }
        } else {
            FileFixStatus::NoAutofix
        };
        groups.entry(artist).or_default().push((rel, ann, fix_status));
    }
    for files in groups.values_mut() {
        files.sort_by(|a, b| a.0.cmp(&b.0));
    }
    groups
}

fn group_total(groups: &ArtistGroups) -> usize {
    groups.values().map(|v| v.len()).sum()
}

fn group_matched_count(groups: &ArtistGroups) -> usize {
    groups.values().flat_map(|v| v.iter())
        .filter(|(_, _, fs)| matches!(fs, FileFixStatus::Matched))
        .count()
}

/// Collect the sorted union of artist names across multiple ArtistGroups.
fn collect_all_artists(groups_list: &[&ArtistGroups]) -> Vec<String> {
    let mut set = BTreeSet::new();
    for groups in groups_list {
        for key in groups.keys() {
            set.insert(key.clone());
        }
    }
    set.into_iter().collect()
}

/// Filter an ArtistGroups to only include artists in the given set.
fn filter_groups(groups: &ArtistGroups, artists: &HashSet<&str>) -> ArtistGroups {
    groups.iter()
        .filter(|(artist, _)| artists.contains(artist.as_str()))
        .map(|(artist, files)| (artist.clone(), files.clone()))
        .collect()
}

/// Write pagination controls (prev/next + page numbers).
fn write_pagination<W: Write>(
    f: &mut W,
    base_name: &str,
    current_page: usize,
    total_pages: usize,
) -> std::io::Result<()> {
    if total_pages <= 1 {
        return Ok(());
    }
    write!(f, "<div class=\"pagination\">\n")?;
    if current_page > 1 {
        write!(f, "<a href=\"{}_{}.html\">&lsaquo;</a>\n", base_name, current_page - 1)?;
    } else {
        write!(f, "<span class=\"disabled\">&lsaquo;</span>\n")?;
    }
    for p in 1..=total_pages {
        if p == current_page {
            write!(f, "<span class=\"active\">{}</span>\n", p)?;
        } else {
            write!(f, "<a href=\"{}_{}.html\">{}</a>\n", base_name, p, p)?;
        }
    }
    if current_page < total_pages {
        write!(f, "<a href=\"{}_{}.html\">&rsaquo;</a>\n", base_name, current_page + 1)?;
    } else {
        write!(f, "<span class=\"disabled\">&rsaquo;</span>\n")?;
    }
    write!(f, "</div>\n")?;
    Ok(())
}

/// Write the subtab bar. `tabs` = &[(panel_id, label, count, fixed_count), …].
/// The first tab is active by default.
fn write_subtab_bar<W: Write>(
    f: &mut W,
    tabs: &[(&str, &str, usize, usize)],
) -> std::io::Result<()> {
    write!(f, "<div class=\"subtab-bar\">\n")?;
    for (i, &(id, label, count, matched)) in tabs.iter().enumerate() {
        let active = if i == 0 { " active" } else { "" };
        let delta = if matched > 0 {
            format!("<span class=\"match-delta\"> (-{})</span>", matched)
        } else {
            String::new()
        };
        write!(
            f,
            "<button class=\"subtab{}\" onclick=\"switchSubtab(this)\" data-panel=\"panel-{}\">{}<span class=\"subtab-count\">{}{}</span></button>\n",
            active, id, encode_text(label), count, delta
        )?;
    }
    write!(f, "</div>\n")?;
    Ok(())
}

/// Write a single collapsible-artist-grouped panel.
/// `active` controls whether the panel is visible on load.
/// When `diffs`, `category`, and `scan_root` are provided, matched files get strikethrough styling
/// and a popover showing field-level changes.
fn write_field_panel<W: Write>(
    f: &mut W,
    panel_id: &str,
    groups: &ArtistGroups,
    active: bool,
    category: &str,
    diffs: Option<&MatchDiffs>,
    scan_root: &str,
) -> std::io::Result<()> {
    let hidden = if active { "" } else { " hidden" };
    write!(f, "<div class=\"panel{}\" id=\"panel-{}\">\n", hidden, panel_id)?;
    if groups.is_empty() {
        write!(f, "<div class=\"empty-panel\">No issues found</div>\n")?;
    } else {
        write!(f, "<div class=\"artist-list\">\n")?;
        for (artist, files) in groups {
            write!(
                f,
                "<div class=\"artist-group\">\n\
                 <div class=\"artist-header\" onclick=\"toggleArtist(this)\">\
                 <span class=\"arrow\">&#9660;</span>\
                 <span class=\"artist-name\">{}</span>\
                 <span class=\"file-count\">{} file{}</span>\
                 </div>\n\
                 <ul class=\"file-list\">\n",
                encode_text(artist),
                files.len(),
                if files.len() == 1 { "" } else { "s" }
            )?;
            for (path, ann, fix_status) in files {
                let ann_html = ann.as_ref()
                    .map(|a| format!(" <span class=\"annot\">{}</span>", encode_text(a)))
                    .unwrap_or_default();

                match fix_status {
                    FileFixStatus::Matched => {
                        // Strikethrough + dim + green check + popover with field diffs
                        let full_path = PathBuf::from(scan_root).join(path);
                        let popover_html = if let Some(d) = diffs {
                            if let Some(fixes) = d.get(&full_path) {
                                let cat_fixes: Vec<&FieldMatch> = fixes.iter()
                                    .filter(|fix| fix.category == category)
                                    .collect();
                                if !cat_fixes.is_empty() {
                                    let mut pop = String::from("<div class=\"match-popover\"><div class=\"pop-title\">Matched by beets:</div>");
                                    for fix in &cat_fixes {
                                        pop.push_str(&format!(
                                            "<div><span class=\"pop-old\">{}: {}</span><span class=\"pop-arrow\">&rarr;</span><span class=\"pop-new\">{}</span></div>",
                                            encode_text(fix.field),
                                            encode_text(&fix.old_display),
                                            encode_text(&fix.new_value),
                                        ));
                                    }
                                    pop.push_str("</div>");
                                    pop
                                } else {
                                    String::new()
                                }
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        };
                        write!(
                            f,
                            "<li class=\"file-item matched\">{}{}<span class=\"match-check\" onmouseenter=\"showMatchInfo(this)\" onmouseleave=\"hideMatchInfo(this)\">&#10003;</span>{}</li>\n",
                            encode_text(path), ann_html, popover_html
                        )?;
                    }
                    FileFixStatus::Skipped(_) => {
                        write!(f, "<li class=\"file-item\">{}{}</li>\n", encode_text(path), ann_html)?;
                    }
                    FileFixStatus::NoAutofix => {
                        write!(f, "<li class=\"file-item\">{}{}</li>\n", encode_text(path), ann_html)?;
                    }
                }
            }
            write!(f, "</ul>\n</div>\n")?;
        }
        write!(f, "</div>\n")?;
    }
    write!(f, "</div>\n")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: navigation bar
// ---------------------------------------------------------------------------

fn write_nav<W: Write>(
    f: &mut W,
    active: &str,
    counts: &NavCounts,
    pages: &PageFlags,
    from_index: bool,
) -> std::io::Result<()> {
    // (id, label, filename, count, fixed_count, show)
    let entries: Vec<(&str, &str, &str, Option<usize>, usize, bool)> = vec![
        ("overview", "Overview", "index.html", None, 0, true),
        ("issues", "Issues", "issues.html", Some(counts.issues), 0, true),
        ("critical", "Critical", "critical_1.html", Some(counts.critical), counts.critical_matched, pages.critical),
        ("mb", "MusicBrainz", "mb_1.html", Some(counts.mb), counts.mb_matched, pages.mb),
        ("discogs", "Discogs", "discogs_1.html", Some(counts.discogs), counts.discogs_matched, pages.discogs),
        ("ids", "IDs", "ids_1.html", Some(counts.ids), counts.ids_matched, pages.ids),
        ("other", "Other", "other_1.html", Some(counts.other), counts.other_matched, pages.other),
    ];

    write!(f, "<nav class=\"nav-bar\">\n")?;
    for (id, label, filename, count, matched, show) in &entries {
        if !show { continue; }
        let href = if *filename == "index.html" {
            if from_index { "index.html".to_string() } else { "../index.html".to_string() }
        } else if from_index {
            format!("pages/{}", filename)
        } else {
            filename.to_string()
        };
        let active_class = if *id == active { " active" } else { "" };
        let badge = match count {
            Some(n) => {
                let delta = if *matched > 0 {
                    format!("<span class=\"match-delta\"> (-{})</span>", matched)
                } else {
                    String::new()
                };
                format!("<span class=\"badge\">{}{}</span>", n, delta)
            }
            None => String::new(),
        };
        write!(f, "<a href=\"{}\" class=\"nav-tab{}\">{}{}</a>\n", href, active_class, label, badge)?;
    }
    write!(f, "</nav>\n")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: page shell (start / end)
// ---------------------------------------------------------------------------

fn write_page_start<W: Write>(
    f: &mut W,
    title: &str,
    from_index: bool,
) -> std::io::Result<()> {
    let css_path = if from_index { "css/styles.css" } else { "../css/styles.css" };
    write!(f, "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n\
        <meta charset=\"UTF-8\">\n\
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n\
        <title>{} &mdash; Audio Metadata Analysis</title>\n\
        <link rel=\"stylesheet\" href=\"{}\">\n\
        </head>\n<body>\n<div class=\"container\">\n\
        <h1>Audio Metadata Analysis</h1>\n",
        encode_text(title), css_path
    )?;
    Ok(())
}

fn write_page_end<W: Write>(f: &mut W, from_index: bool) -> std::io::Result<()> {
    let js_path = if from_index { "js/report.js" } else { "../js/report.js" };
    write!(f, "<script src=\"{}\"></script>\n</div>\n</body>\n</html>\n", js_path)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: index.html
// ---------------------------------------------------------------------------

fn write_index(
    report_dir: &Path,
    scan_root: &str,
    total_files: u64,
    total_size: u64,
    error_count: u64,
    file_type_counts: &HashMap<String, u64>,
    elapsed: std::time::Duration,
    issues_len: usize,
    counts: &NavCounts,
    pages: &PageFlags,
) -> std::io::Result<()> {
    let path = report_dir.join("index.html");
    let mut f = BufWriter::new(fs::File::create(&path)?);

    write_page_start(&mut f, "Overview", true)?;

    // Subtitle
    write!(f, "<p class=\"subtitle\">\
        <span>Scanned <code>{}</code></span>\
        <span class=\"meta\">{} &middot; {:.2}s</span>\
        </p>\n",
        encode_text(scan_root),
        human_size(total_size),
        elapsed.as_secs_f64(),
    )?;

    write_nav(&mut f, "overview", counts, pages, true)?;

    // Stats cards
    let readable = total_files.saturating_sub(error_count);
    let ok_count = readable.saturating_sub(issues_len as u64);

    write!(f, "<div class=\"stats-container\">\n<div class=\"stats-group\">\n")?;

    // File type stats
    let mut sorted_types: Vec<_> = file_type_counts.iter().collect();
    sorted_types.sort_by(|a, b| b.1.cmp(a.1));
    for (ext, count) in &sorted_types {
        write!(f, "<div class=\"stat-card\"><div class=\"label\">{}</div><div class=\"value info\">{}</div></div>\n",
            encode_text(ext), count)?;
    }

    write!(f, "</div>\n<div class=\"stats-group\">\n")?;
    write!(f, "<div class=\"stat-card\"><div class=\"label\">Files OK</div><div class=\"value ok\">{}</div></div>\n", ok_count)?;
    write!(f, "<div class=\"stat-card\"><div class=\"label\">Files with Issues</div><div class=\"value fail\">{}</div></div>\n", issues_len)?;
    write!(f, "<div class=\"stat-card\"><div class=\"label\">Unreadable Files</div><div class=\"value warn\">{}</div></div>\n", error_count)?;
    write!(f, "</div>\n</div>\n")?;

    // Category breakdown
    write!(f, "<div class=\"breakdown\">\n<h2>Breakdown by Category</h2>\n\
        <div class=\"table-wrap\"><table>\n\
        <thead><tr><th>Category</th><th>Issues</th><th></th></tr></thead>\n<tbody>\n")?;

    let breakdown: &[(&str, &str, usize, bool)] = &[
        ("Issues", "pages/issues.html", counts.issues, true),
        ("Critical", "pages/critical_1.html", counts.critical, pages.critical),
        ("MusicBrainz", "pages/mb_1.html", counts.mb, pages.mb),
        ("Discogs", "pages/discogs_1.html", counts.discogs, pages.discogs),
        ("IDs", "pages/ids_1.html", counts.ids, pages.ids),
        ("Other", "pages/other_1.html", counts.other, pages.other),
    ];
    for &(label, href, count, show) in breakdown {
        if !show { continue; }
        write!(f, "<tr><td>{}</td><td>{}</td><td><a href=\"{}\">View &rarr;</a></td></tr>\n",
            label, count, href)?;
    }

    write!(f, "</tbody>\n</table></div>\n</div>\n")?;
    write_page_end(&mut f, true)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: issues.html
// ---------------------------------------------------------------------------

fn write_issues_page(
    report_dir: &Path,
    scan_root: &str,
    all_paths: &[PathBuf],
    parent_audio_count: &HashMap<PathBuf, usize>,
    unreadable: &[(PathBuf, String)],
    counts: &NavCounts,
    pages: &PageFlags,
) -> std::io::Result<()> {
    let path = report_dir.join("pages/issues.html");
    let mut f = BufWriter::new(fs::File::create(&path)?);

    write_page_start(&mut f, "Issues", false)?;
    write_nav(&mut f, "issues", counts, pages, false)?;

    write!(f, "<div class=\"search-box\"><input type=\"text\" placeholder=\"Filter files\u{2026}\" oninput=\"filterTable(this)\"></div>\n")?;
    write!(f, "<div class=\"table-wrap\"><table>\n\
        <thead><tr><th data-sort=\"0\">Path</th><th data-sort=\"1\">Problem</th></tr></thead>\n<tbody>\n")?;

    // Lone files (only one audio file in parent directory)
    let mut lone_files: Vec<&PathBuf> = all_paths.iter()
        .filter(|p| {
            p.parent()
                .and_then(|par| parent_audio_count.get(par))
                .copied()
                .unwrap_or(0) == 1
        })
        .collect();
    lone_files.sort();

    for p in &lone_files {
        let rel = relative_path(p, scan_root);
        write!(f, "<tr><td title=\"{}\">{}</td><td>Only one file</td></tr>\n",
            encode_text(&p.to_string_lossy()), encode_text(&rel))?;
    }

    // Unreadable files
    let mut sorted_unreadable: Vec<&(PathBuf, String)> = unreadable.iter().collect();
    sorted_unreadable.sort_by(|a, b| a.0.cmp(&b.0));

    for (p, err) in &sorted_unreadable {
        let rel = relative_path(p, scan_root);
        write!(f, "<tr><td title=\"{}\">{}</td><td>{}</td></tr>\n",
            encode_text(&p.to_string_lossy()),
            encode_text(&rel),
            encode_text(err))?;
    }

    if lone_files.is_empty() && sorted_unreadable.is_empty() {
        write!(f, "<tr><td colspan=\"2\" class=\"empty-state\">No issues found</td></tr>\n")?;
    }

    write!(f, "</tbody>\n</table></div>\n")?;
    write_page_end(&mut f, false)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: critical.html
// ---------------------------------------------------------------------------

fn write_critical_page(
    report_dir: &Path,
    scan_root: &str,
    issues: &[FileIssue],
    counts: &NavCounts,
    pages: &PageFlags,
    diffs: Option<&MatchDiffs>,
    skipped_files: Option<&SkippedFiles>,
) -> std::io::Result<()> {
    // Build per-field groups
    let artist_groups = build_groups(
        issues, scan_root,
        |i| i.missing_artist || i.blank_artist,
        |i| if i.blank_artist { Some("(blank)".into()) } else { None },
        diffs, skipped_files, Some("Artist"),
    );
    let title_groups = build_groups(
        issues, scan_root,
        |i| i.missing_title || i.blank_title,
        |i| if i.blank_title { Some("(blank)".into()) } else { None },
        diffs, skipped_files, Some("Title"),
    );
    let year_groups = build_groups(
        issues, scan_root,
        |i| i.missing_year || i.blank_year || i.invalid_year.is_some(),
        |i| {
            if i.blank_year { Some("(blank)".into()) }
            else if let Some(v) = &i.invalid_year { Some(format!("({})", v)) }
            else { None }
        },
        diffs, skipped_files, Some("Year"),
    );

    let all_artists = collect_all_artists(&[&artist_groups, &title_groups, &year_groups]);
    let total_pages = ((all_artists.len() + ARTISTS_PER_PAGE - 1) / ARTISTS_PER_PAGE).max(1);

    for page_num in 1..=total_pages {
        let start = (page_num - 1) * ARTISTS_PER_PAGE;
        let end = (start + ARTISTS_PER_PAGE).min(all_artists.len());
        let page_artists: HashSet<&str> = if start < all_artists.len() {
            all_artists[start..end].iter().map(|s| s.as_str()).collect()
        } else {
            HashSet::new()
        };

        let pg_artist = filter_groups(&artist_groups, &page_artists);
        let pg_title  = filter_groups(&title_groups, &page_artists);
        let pg_year   = filter_groups(&year_groups, &page_artists);

        let path = report_dir.join(format!("pages/critical_{}.html", page_num));
        let mut f = BufWriter::new(fs::File::create(&path)?);

        write_page_start(&mut f, "Critical", false)?;
        write_nav(&mut f, "critical", counts, pages, false)?;

        let tabs: &[(&str, &str, usize, usize)] = &[
            ("artist", "Artist",  group_total(&pg_artist), group_matched_count(&pg_artist)),
            ("title",  "Title",   group_total(&pg_title),  group_matched_count(&pg_title)),
            ("year",   "Year",    group_total(&pg_year),   group_matched_count(&pg_year)),
        ];

        write!(f, "<div class=\"search-box\"><input type=\"text\" placeholder=\"Filter files\u{2026}\" oninput=\"filterGroups(this)\"></div>\n")?;
        write_pagination(&mut f, "critical", page_num, total_pages)?;
        write_subtab_bar(&mut f, tabs)?;
        write_field_panel(&mut f, "artist", &pg_artist, true,  "critical", diffs, scan_root)?;
        write_field_panel(&mut f, "title",  &pg_title,  false, "critical", diffs, scan_root)?;
        write_field_panel(&mut f, "year",   &pg_year,   false, "critical", diffs, scan_root)?;
        write_pagination(&mut f, "critical", page_num, total_pages)?;

        write_page_end(&mut f, false)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: mb.html
// ---------------------------------------------------------------------------

fn write_mb_page(
    report_dir: &Path,
    scan_root: &str,
    issues: &[FileIssue],
    counts: &NavCounts,
    pages: &PageFlags,
    diffs: Option<&MatchDiffs>,
    skipped_files: Option<&SkippedFiles>,
) -> std::io::Result<()> {
    let artist_groups = build_groups(issues, scan_root, |i| i.missing_mb_artist_id, |_| None, diffs, skipped_files, Some("MB Artist ID"));
    let track_groups  = build_groups(issues, scan_root, |i| i.missing_mb_track_id,  |_| None, diffs, skipped_files, Some("MB Track ID"));
    let album_groups  = build_groups(issues, scan_root, |i| i.missing_mb_album_id,  |_| None, diffs, skipped_files, Some("MB Album ID"));

    let all_artists = collect_all_artists(&[&artist_groups, &track_groups, &album_groups]);
    let total_pages = ((all_artists.len() + ARTISTS_PER_PAGE - 1) / ARTISTS_PER_PAGE).max(1);

    for page_num in 1..=total_pages {
        let start = (page_num - 1) * ARTISTS_PER_PAGE;
        let end = (start + ARTISTS_PER_PAGE).min(all_artists.len());
        let page_artists: HashSet<&str> = if start < all_artists.len() {
            all_artists[start..end].iter().map(|s| s.as_str()).collect()
        } else {
            HashSet::new()
        };

        let pg_artist = filter_groups(&artist_groups, &page_artists);
        let pg_track  = filter_groups(&track_groups, &page_artists);
        let pg_album  = filter_groups(&album_groups, &page_artists);

        let path = report_dir.join(format!("pages/mb_{}.html", page_num));
        let mut f = BufWriter::new(fs::File::create(&path)?);

        write_page_start(&mut f, "MusicBrainz", false)?;
        write_nav(&mut f, "mb", counts, pages, false)?;

        let tabs: &[(&str, &str, usize, usize)] = &[
            ("mb-artist", "MB Artist", group_total(&pg_artist), group_matched_count(&pg_artist)),
            ("mb-track",  "MB Track",  group_total(&pg_track),  group_matched_count(&pg_track)),
            ("mb-album",  "MB Album",  group_total(&pg_album),  group_matched_count(&pg_album)),
        ];

        write!(f, "<div class=\"search-box\"><input type=\"text\" placeholder=\"Filter files\u{2026}\" oninput=\"filterGroups(this)\"></div>\n")?;
        write_pagination(&mut f, "mb", page_num, total_pages)?;
        write_subtab_bar(&mut f, tabs)?;
        write_field_panel(&mut f, "mb-artist", &pg_artist, true,  "mb", diffs, scan_root)?;
        write_field_panel(&mut f, "mb-track",  &pg_track,  false, "mb", diffs, scan_root)?;
        write_field_panel(&mut f, "mb-album",  &pg_album,  false, "mb", diffs, scan_root)?;
        write_pagination(&mut f, "mb", page_num, total_pages)?;

        write_page_end(&mut f, false)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: discogs.html
// ---------------------------------------------------------------------------

fn write_discogs_page(
    report_dir: &Path,
    scan_root: &str,
    issues: &[FileIssue],
    counts: &NavCounts,
    pages: &PageFlags,
    diffs: Option<&MatchDiffs>,
    skipped_files: Option<&SkippedFiles>,
) -> std::io::Result<()> {
    let artist_groups  = build_groups(issues, scan_root, |i| i.missing_discogs_artist,  |_| None, diffs, skipped_files, Some("Discogs Artist"));
    let release_groups = build_groups(issues, scan_root, |i| i.missing_discogs_release, |_| None, diffs, skipped_files, Some("Discogs Release"));

    let all_artists = collect_all_artists(&[&artist_groups, &release_groups]);
    let total_pages = ((all_artists.len() + ARTISTS_PER_PAGE - 1) / ARTISTS_PER_PAGE).max(1);

    for page_num in 1..=total_pages {
        let start = (page_num - 1) * ARTISTS_PER_PAGE;
        let end = (start + ARTISTS_PER_PAGE).min(all_artists.len());
        let page_artists: HashSet<&str> = if start < all_artists.len() {
            all_artists[start..end].iter().map(|s| s.as_str()).collect()
        } else {
            HashSet::new()
        };

        let pg_artist  = filter_groups(&artist_groups, &page_artists);
        let pg_release = filter_groups(&release_groups, &page_artists);

        let path = report_dir.join(format!("pages/discogs_{}.html", page_num));
        let mut f = BufWriter::new(fs::File::create(&path)?);

        write_page_start(&mut f, "Discogs", false)?;
        write_nav(&mut f, "discogs", counts, pages, false)?;

        let tabs: &[(&str, &str, usize, usize)] = &[
            ("dg-artist",  "Discogs Artist",  group_total(&pg_artist),  group_matched_count(&pg_artist)),
            ("dg-release", "Discogs Release", group_total(&pg_release), group_matched_count(&pg_release)),
        ];

        write!(f, "<div class=\"search-box\"><input type=\"text\" placeholder=\"Filter files\u{2026}\" oninput=\"filterGroups(this)\"></div>\n")?;
        write_pagination(&mut f, "discogs", page_num, total_pages)?;
        write_subtab_bar(&mut f, tabs)?;
        write_field_panel(&mut f, "dg-artist",  &pg_artist,  true,  "discogs", diffs, scan_root)?;
        write_field_panel(&mut f, "dg-release", &pg_release, false, "discogs", diffs, scan_root)?;
        write_pagination(&mut f, "discogs", page_num, total_pages)?;

        write_page_end(&mut f, false)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: ids.html
// ---------------------------------------------------------------------------

fn write_ids_page(
    report_dir: &Path,
    scan_root: &str,
    issues: &[FileIssue],
    counts: &NavCounts,
    pages: &PageFlags,
    diffs: Option<&MatchDiffs>,
    skipped_files: Option<&SkippedFiles>,
) -> std::io::Result<()> {
    let acoustic_groups  = build_groups(issues, scan_root, |i| i.missing_acoustic_id,       |_| None, diffs, skipped_files, Some("Acoustic ID"));
    let songkong_groups  = build_groups(issues, scan_root, |i| i.missing_songkong_id,        |_| None, diffs, skipped_files, Some("SongKong ID"));
    let bandcamp_groups  = build_groups(issues, scan_root, |i| i.missing_bandcamp,           |_| None, diffs, skipped_files, Some("Bandcamp"));
    let wiki_groups      = build_groups(issues, scan_root, |i| i.missing_wikipedia_artist,   |_| None, diffs, skipped_files, Some("Wikipedia Artist"));

    let all_artists = collect_all_artists(&[&acoustic_groups, &songkong_groups, &bandcamp_groups, &wiki_groups]);
    let total_pages = ((all_artists.len() + ARTISTS_PER_PAGE - 1) / ARTISTS_PER_PAGE).max(1);

    for page_num in 1..=total_pages {
        let start = (page_num - 1) * ARTISTS_PER_PAGE;
        let end = (start + ARTISTS_PER_PAGE).min(all_artists.len());
        let page_artists: HashSet<&str> = if start < all_artists.len() {
            all_artists[start..end].iter().map(|s| s.as_str()).collect()
        } else {
            HashSet::new()
        };

        let pg_acoustic = filter_groups(&acoustic_groups, &page_artists);
        let pg_songkong = filter_groups(&songkong_groups, &page_artists);
        let pg_bandcamp = filter_groups(&bandcamp_groups, &page_artists);
        let pg_wiki     = filter_groups(&wiki_groups, &page_artists);

        let path = report_dir.join(format!("pages/ids_{}.html", page_num));
        let mut f = BufWriter::new(fs::File::create(&path)?);

        write_page_start(&mut f, "IDs", false)?;
        write_nav(&mut f, "ids", counts, pages, false)?;

        let tabs: &[(&str, &str, usize, usize)] = &[
            ("acoustic",  "Acoustic ID", group_total(&pg_acoustic), group_matched_count(&pg_acoustic)),
            ("songkong",  "SongKong",    group_total(&pg_songkong), group_matched_count(&pg_songkong)),
            ("bandcamp",  "Bandcamp",    group_total(&pg_bandcamp), group_matched_count(&pg_bandcamp)),
            ("wikipedia", "Wikipedia",   group_total(&pg_wiki),     group_matched_count(&pg_wiki)),
        ];

        write!(f, "<div class=\"search-box\"><input type=\"text\" placeholder=\"Filter files\u{2026}\" oninput=\"filterGroups(this)\"></div>\n")?;
        write_pagination(&mut f, "ids", page_num, total_pages)?;
        write_subtab_bar(&mut f, tabs)?;
        write_field_panel(&mut f, "acoustic",  &pg_acoustic, true,  "ids", diffs, scan_root)?;
        write_field_panel(&mut f, "songkong",  &pg_songkong, false, "ids", diffs, scan_root)?;
        write_field_panel(&mut f, "bandcamp",  &pg_bandcamp, false, "ids", diffs, scan_root)?;
        write_field_panel(&mut f, "wikipedia", &pg_wiki,     false, "ids", diffs, scan_root)?;
        write_pagination(&mut f, "ids", page_num, total_pages)?;

        write_page_end(&mut f, false)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: other.html
// ---------------------------------------------------------------------------

fn write_other_page(
    report_dir: &Path,
    scan_root: &str,
    issues: &[FileIssue],
    counts: &NavCounts,
    pages: &PageFlags,
    diffs: Option<&MatchDiffs>,
    skipped_files: Option<&SkippedFiles>,
) -> std::io::Result<()> {
    let genre_groups = build_groups(
        issues, scan_root,
        |i| i.missing_genre || i.blank_genre,
        |i| if i.blank_genre { Some("(blank)".into()) } else { None },
        diffs, skipped_files, Some("Genre"),
    );
    let bpm_groups   = build_groups(issues, scan_root, |i| i.missing_bpm,       |_| None, diffs, skipped_files, Some("BPM"));
    let mood_groups  = build_groups(issues, scan_root, |i| i.missing_mood,       |_| None, diffs, skipped_files, Some("Mood"));
    let art_groups   = build_groups(issues, scan_root, |i| i.missing_album_art,  |_| None, diffs, skipped_files, Some("Album Art"));

    let all_artists = collect_all_artists(&[&genre_groups, &bpm_groups, &mood_groups, &art_groups]);
    let total_pages = ((all_artists.len() + ARTISTS_PER_PAGE - 1) / ARTISTS_PER_PAGE).max(1);

    for page_num in 1..=total_pages {
        let start = (page_num - 1) * ARTISTS_PER_PAGE;
        let end = (start + ARTISTS_PER_PAGE).min(all_artists.len());
        let page_artists: HashSet<&str> = if start < all_artists.len() {
            all_artists[start..end].iter().map(|s| s.as_str()).collect()
        } else {
            HashSet::new()
        };

        let pg_genre = filter_groups(&genre_groups, &page_artists);
        let pg_bpm   = filter_groups(&bpm_groups, &page_artists);
        let pg_mood  = filter_groups(&mood_groups, &page_artists);
        let pg_art   = filter_groups(&art_groups, &page_artists);

        let path = report_dir.join(format!("pages/other_{}.html", page_num));
        let mut f = BufWriter::new(fs::File::create(&path)?);

        write_page_start(&mut f, "Other", false)?;
        write_nav(&mut f, "other", counts, pages, false)?;

        let tabs: &[(&str, &str, usize, usize)] = &[
            ("genre",     "Genre",     group_total(&pg_genre), group_matched_count(&pg_genre)),
            ("bpm",       "BPM",       group_total(&pg_bpm),   group_matched_count(&pg_bpm)),
            ("mood",      "Mood",      group_total(&pg_mood),  group_matched_count(&pg_mood)),
            ("album-art", "Album Art", group_total(&pg_art),   group_matched_count(&pg_art)),
        ];

        write!(f, "<div class=\"search-box\"><input type=\"text\" placeholder=\"Filter files\u{2026}\" oninput=\"filterGroups(this)\"></div>\n")?;
        write_pagination(&mut f, "other", page_num, total_pages)?;
        write_subtab_bar(&mut f, tabs)?;
        write_field_panel(&mut f, "genre",     &pg_genre, true,  "other", diffs, scan_root)?;
        write_field_panel(&mut f, "bpm",       &pg_bpm,   false, "other", diffs, scan_root)?;
        write_field_panel(&mut f, "mood",      &pg_mood,  false, "other", diffs, scan_root)?;
        write_field_panel(&mut f, "album-art", &pg_art,   false, "other", diffs, scan_root)?;
        write_pagination(&mut f, "other", page_num, total_pages)?;

        write_page_end(&mut f, false)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Report: orchestrator
// ---------------------------------------------------------------------------

fn generate_report(
    issues: &[FileIssue],
    all_paths: &[PathBuf],
    parent_audio_count: &HashMap<PathBuf, usize>,
    unreadable: &[(PathBuf, String)],
    scan_root: &str,
    total_files: u64,
    total_size: u64,
    error_count: u64,
    file_type_counts: &HashMap<String, u64>,
    elapsed: std::time::Duration,
    report_dir: &Path,
    pages: &PageFlags,
    diffs: Option<&MatchDiffs>,
    skipped_files: Option<&SkippedFiles>,
) -> std::io::Result<()> {
    // Create directory structure
    fs::create_dir_all(report_dir.join("css"))?;
    fs::create_dir_all(report_dir.join("js"))?;
    fs::create_dir_all(report_dir.join("pages"))?;

    // Compute lone files count for nav badge
    let lone_count = all_paths.iter()
        .filter(|p| {
            p.parent()
                .and_then(|par| parent_audio_count.get(par))
                .copied()
                .unwrap_or(0) == 1
        })
        .count();

    // Compute matched counts per category from autofix diffs
    let (critical_matched, mb_matched, discogs_matched, ids_matched, other_matched) = if let Some(d) = diffs {
        let mut cf = HashSet::new();
        let mut mf = HashSet::new();
        let mut df = HashSet::new();
        let mut idf = HashSet::new();
        let mut of = HashSet::new();
        for (path, fixes) in d {
            for fix in fixes {
                match fix.category {
                    "critical" => { cf.insert(path); }
                    "mb"       => { mf.insert(path); }
                    "discogs"  => { df.insert(path); }
                    "ids"      => { idf.insert(path); }
                    "other"    => { of.insert(path); }
                    _ => {}
                }
            }
        }
        (cf.len(), mf.len(), df.len(), idf.len(), of.len())
    } else {
        (0, 0, 0, 0, 0)
    };

    let counts = NavCounts {
        issues: lone_count + unreadable.len(),
        critical: issues.iter().filter(|i| i.has_critical()).count(),
        mb: issues.iter().filter(|i| i.has_mb()).count(),
        discogs: issues.iter().filter(|i| i.has_discogs()).count(),
        ids: issues.iter().filter(|i| i.has_ids()).count(),
        other: issues.iter().filter(|i| i.has_other()).count(),
        critical_matched,
        mb_matched,
        discogs_matched,
        ids_matched,
        other_matched,
    };

    // Write shared assets
    fs::write(report_dir.join("css/styles.css"), CSS)?;
    fs::write(report_dir.join("js/report.js"), JS)?;

    // Write index (always)
    write_index(
        report_dir, scan_root, total_files, total_size, error_count,
        file_type_counts, elapsed, issues.len(), &counts, pages,
    )?;

    // Write selected pages
    // Issues page is always generated (lone files + unreadable files are always relevant)
    write_issues_page(report_dir, scan_root, all_paths, parent_audio_count, unreadable, &counts, pages)?;
    if pages.critical {
        write_critical_page(report_dir, scan_root, issues, &counts, pages, diffs, skipped_files)?;
    }
    if pages.mb {
        write_mb_page(report_dir, scan_root, issues, &counts, pages, diffs, skipped_files)?;
    }
    if pages.discogs {
        write_discogs_page(report_dir, scan_root, issues, &counts, pages, diffs, skipped_files)?;
    }
    if pages.ids {
        write_ids_page(report_dir, scan_root, issues, &counts, pages, diffs, skipped_files)?;
    }
    if pages.other {
        write_other_page(report_dir, scan_root, issues, &counts, pages, diffs, skipped_files)?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Autofix: beets integration
// ---------------------------------------------------------------------------

/// Print detailed installation instructions for beets and its required plugins.
fn print_beet_install_instructions() {
    eprintln!();
    eprintln!("ERROR: beet (beets) is not installed or not found in PATH.");
    eprintln!();
    eprintln!("Install beets and required dependencies:");
    eprintln!();
    eprintln!("  # Core");
    eprintln!("  pip install beets");
    eprintln!();
    eprintln!("  # Required plugins");
    eprintln!("  pip install pyacoustid              # AcoustID fingerprinting (chroma plugin)");
    eprintln!("  pip install python-discogs-client    # Discogs metadata");
    eprintln!();
    eprintln!("  # Chromaprint fingerprinter (system package)");
    eprintln!("  sudo apt install libchromaprint-tools   # provides fpcalc");
    eprintln!();
    eprintln!("  # Recommended plugins");
    eprintln!("  pip install beets-bandcamp           # Bandcamp metadata");
    eprintln!("  pip install pylast                   # Last.fm genre tagging");
    eprintln!();
    eprintln!("Configure beets (~/.config/beets/config.yaml):");
    eprintln!();
    eprintln!("  plugins:");
    eprintln!("    - chroma");
    eprintln!("    - discogs");
    eprintln!("    - fetchart");
    eprintln!("    - embedart");
    eprintln!("    - lastgenre");
    eprintln!("    - bandcamp");
    eprintln!();
    eprintln!("  import:");
    eprintln!("    write: yes");
    eprintln!("    move: no");
    eprintln!("    copy: no");
    eprintln!("    quiet: yes");
    eprintln!();
    eprintln!("  acoustid:");
    eprintln!("    apikey: YOUR_KEY   # Get from https://acoustid.org/api-key");
    eprintln!();
    eprintln!("  chroma:");
    eprintln!("    auto: yes");
    eprintln!();
    eprintln!("  discogs:");
    eprintln!("    user_token: YOUR_TOKEN   # Get from https://www.discogs.com/settings/developers");
}

/// Check beets availability and required plugins. Returns Ok(version_string) or exits.
fn check_beets_setup() {
    // 1. Check beet binary
    let beet_output = match std::process::Command::new("beet")
        .arg("version")
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => {
            print_beet_install_instructions();
            std::process::exit(1);
        }
    };

    let version_str = String::from_utf8_lossy(&beet_output.stdout);
    for line in version_str.lines() {
        println!("  {}", line.trim());
    }

    // 2. Check fpcalc (chromaprint fingerprinter)
    if std::process::Command::new("fpcalc")
        .arg("-version")
        .output()
        .is_err()
    {
        eprintln!();
        eprintln!("ERROR: fpcalc not found. Required by the chroma plugin for AcoustID fingerprinting.");
        eprintln!();
        eprintln!("  Install: sudo apt install libchromaprint-tools");
        std::process::exit(1);
    }

    // 3. Check required plugins from version output
    let required = &["chroma", "discogs"];
    let recommended = &["bandcamp", "fetchart", "embedart", "lastgenre"];

    let mut missing_required: Vec<&str> = Vec::new();
    let mut missing_recommended: Vec<&str> = Vec::new();

    for &plugin in required {
        if !version_str.contains(plugin) {
            missing_required.push(plugin);
        }
    }
    for &plugin in recommended {
        if !version_str.contains(plugin) {
            missing_recommended.push(plugin);
        }
    }

    if !missing_required.is_empty() {
        eprintln!();
        eprintln!("ERROR: Missing required beets plugins: {}", missing_required.join(", "));
        eprintln!();
        for &p in &missing_required {
            match p {
                "chroma" => eprintln!("  pip install pyacoustid              # chroma plugin (AcoustID)"),
                "discogs" => eprintln!("  pip install python-discogs-client    # discogs plugin"),
                _ => eprintln!("  # Enable '{}' in your beets config plugins list", p),
            }
        }
        eprintln!();
        eprintln!("Then add them to plugins: in ~/.config/beets/config.yaml");
        std::process::exit(1);
    }

    if !missing_recommended.is_empty() {
        println!("  Note: recommended plugins not loaded: {}", missing_recommended.join(", "));
    }
}

/// Run the autofix phase: invoke beet import on each directory containing files with issues.
/// Returns a map of directory → skip reason for directories beets skipped (real run only).
/// For dry runs the returned map is always empty.
fn run_autofix(
    issues: &[FileIssue],
    scan_root: &str,
    parent_audio_count: &HashMap<PathBuf, usize>,
    dry: bool,
) -> HashMap<PathBuf, String> {
    let label = if dry { "Autofix DRY RUN" } else { "Autofix" };

    println!("\n[{}] Checking beets installation...", label);
    check_beets_setup();

    // Group issue files by parent directory
    let mut dirs_to_fix: BTreeMap<PathBuf, usize> = BTreeMap::new();
    for issue in issues {
        if let Some(parent) = issue.path.parent() {
            *dirs_to_fix.entry(parent.to_path_buf()).or_insert(0) += 1;
        }
    }

    let total_dirs = dirs_to_fix.len();
    if total_dirs == 0 {
        println!("\n[{}] No directories to process.", label);
        return HashMap::new();
    }

    println!("\n[{}] Processing {} director{} ({} files with issues)...\n",
        label,
        total_dirs,
        if total_dirs == 1 { "y" } else { "ies" },
        issues.len(),
    );

    // Use a temporary library to avoid polluting user's main beet DB
    let tmp_lib = format!("/tmp/analysis_autofix_{}.db", std::process::id());

    let mut processed = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;
    // dir → skip reason (only for non-dry runs, only for skipped dirs)
    let mut skipped_dirs: HashMap<PathBuf, String> = HashMap::new();

    for (idx, (dir, file_count)) in dirs_to_fix.iter().enumerate() {
        let rel = dir
            .to_string_lossy()
            .strip_prefix(scan_root)
            .unwrap_or(&dir.to_string_lossy())
            .trim_start_matches('/')
            .to_string();

        let is_singleton = parent_audio_count.get(dir).copied().unwrap_or(0) == 1;

        print!("  [{}/{}] {} ({} file{}) ... ",
            idx + 1, total_dirs, rel, file_count,
            if *file_count == 1 { "" } else { "s" },
        );
        std::io::stdout().flush().ok();

        let mut cmd = std::process::Command::new("beet");
        cmd.arg("-l").arg(&tmp_lib)
            .arg("import")
            .arg("-C")    // don't copy/move files
            .arg("-q");   // quiet mode (no prompts, skip uncertain matches)

        if dry {
            cmd.arg("--pretend"); // dry run: show what would be tagged
        } else {
            cmd.arg("-w");        // write tags to files
        }

        if is_singleton {
            cmd.arg("-s"); // singleton mode for lone files
        }

        cmd.arg(dir.as_os_str());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        match cmd.output() {
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let combined = format!("{}{}", stdout, stderr);
                if output.status.success() {
                    if combined.to_lowercase().contains("skipping") || combined.to_lowercase().contains("no good match") {
                        // Extract a meaningful reason from beets output, or use a default
                        let reason = combined.lines()
                            .find(|l| {
                                let lower = l.to_lowercase();
                                lower.contains("skipping") || lower.contains("no good match")
                                    || lower.contains("no candidate") || lower.contains("no match")
                            })
                            .map(|l| l.trim().to_string())
                            .unwrap_or_else(|| "No confident match from beets".to_string());
                        println!("skipped (no confident match)");
                        skipped += 1;
                        if !dry {
                            skipped_dirs.insert(dir.clone(), reason);
                        }
                    } else {
                        if dry {
                            println!("would tag");
                            // Print pretend output indented
                            for line in stdout.lines().filter(|l| !l.trim().is_empty()) {
                                println!("    {}", line.trim());
                            }
                        } else {
                            println!("done");
                        }
                        processed += 1;
                    }
                } else {
                    let first_line = combined
                        .lines()
                        .find(|l| !l.trim().is_empty())
                        .unwrap_or("unknown error");
                    println!("error: {}", first_line.trim());
                    failed += 1;
                }
            }
            Err(e) => {
                println!("failed: {}", e);
                failed += 1;
            }
        }
    }

    // Clean up temporary beet library
    let _ = fs::remove_file(&tmp_lib);

    println!();
    println!("[{}] Complete.", label);
    if dry {
        println!("  Would tag: {}", processed);
    } else {
        println!("  Tagged:    {}", processed);
    }
    println!("  Skipped:   {} (no confident match)", skipped);
    println!("  Failed:    {}", failed);

    skipped_dirs
}

// ---------------------------------------------------------------------------
// Autofix: re-scan after beets
// ---------------------------------------------------------------------------

/// Re-scan files that originally had issues, classify fix status, and build per-field diffs.
/// Returns (fixed_paths, still_broken, newly_unreadable, autofix_diffs).
/// Re-scan files that originally had issues, classify fix status, and build per-field diffs.
/// `skip_dirs` maps directories that beets skipped → the skip reason.
/// Returns (fixed_paths, still_broken, newly_unreadable, autofix_diffs, skipped_files).
fn compute_autofix_diffs(
    original_issues: &[FileIssue],
    skip_dirs: &HashMap<PathBuf, String>,
) -> (Vec<PathBuf>, Vec<FileIssue>, Vec<(PathBuf, String)>, MatchDiffs, SkippedFiles) {
    let mut matched: Vec<PathBuf> = Vec::new();
    let mut still_broken: Vec<FileIssue> = Vec::new();
    let mut unreadable: Vec<(PathBuf, String)> = Vec::new();
    let mut diffs: MatchDiffs = HashMap::new();
    // Expand dir-level skip info to individual file paths
    let mut skipped_files: SkippedFiles = HashMap::new();
    for orig in original_issues {
        if let Some(parent) = orig.path.parent() {
            if let Some(reason) = skip_dirs.get(parent) {
                skipped_files.insert(orig.path.clone(), reason.clone());
            }
        }
    }

    for orig in original_issues {
        let (new_issue, _new_tags) = match scan_file(&orig.path) {
            Ok(result) => result,
            Err(err) => {
                unreadable.push((orig.path.clone(), err));
                continue;
            }
        };

        // Re-open file to read new tag values for diffs
        let parse_opts = ParseOptions::new().read_properties(false);
        let tag_map = if let Ok(probe) = Probe::open(&orig.path) {
            if let Ok(tagged) = probe.options(parse_opts).read() {
                collect_tags(&tagged)
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        // Build field-level diffs: for each field that was bad and is now good
        let mut field_matches: Vec<FieldMatch> = Vec::new();

        // --- Critical fields ---
        if orig.missing_artist && !new_issue.missing_artist {
            field_matches.push(FieldMatch {
                field: "Artist",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["ARTIST"]).unwrap_or_default(),
                category: "critical",
            });
        }
        if orig.blank_artist && !new_issue.blank_artist {
            field_matches.push(FieldMatch {
                field: "Artist",
                old_display: "(blank)".into(),
                new_value: get_tag(&tag_map, &["ARTIST"]).unwrap_or_default(),
                category: "critical",
            });
        }
        if orig.missing_title && !new_issue.missing_title {
            field_matches.push(FieldMatch {
                field: "Title",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["TITLE"]).unwrap_or_default(),
                category: "critical",
            });
        }
        if orig.blank_title && !new_issue.blank_title {
            field_matches.push(FieldMatch {
                field: "Title",
                old_display: "(blank)".into(),
                new_value: get_tag(&tag_map, &["TITLE"]).unwrap_or_default(),
                category: "critical",
            });
        }
        if orig.missing_year && !new_issue.missing_year {
            field_matches.push(FieldMatch {
                field: "Year",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["YEAR"]).unwrap_or_default(),
                category: "critical",
            });
        }
        if orig.blank_year && !new_issue.blank_year {
            field_matches.push(FieldMatch {
                field: "Year",
                old_display: "(blank)".into(),
                new_value: get_tag(&tag_map, &["YEAR"]).unwrap_or_default(),
                category: "critical",
            });
        }
        if orig.invalid_year.is_some() && new_issue.invalid_year.is_none() {
            field_matches.push(FieldMatch {
                field: "Year",
                old_display: format!("({})", orig.invalid_year.as_ref().unwrap()),
                new_value: get_tag(&tag_map, &["YEAR"]).unwrap_or_default(),
                category: "critical",
            });
        }

        // --- MusicBrainz fields ---
        if orig.missing_mb_artist_id && !new_issue.missing_mb_artist_id {
            field_matches.push(FieldMatch {
                field: "MB Artist ID",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["MUSICBRAINZ ARTIST ID", "MUSICBRAINZ_ARTISTID", "MUSICBRAINZARTISTID"]).unwrap_or_default(),
                category: "mb",
            });
        }
        if orig.missing_mb_track_id && !new_issue.missing_mb_track_id {
            field_matches.push(FieldMatch {
                field: "MB Track ID",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["MUSICBRAINZ RELEASE TRACK ID", "MUSICBRAINZ_TRACKID", "MUSICBRAINZTRACKID", "MUSICBRAINZ_RELEASETRACKID"]).unwrap_or_default(),
                category: "mb",
            });
        }
        if orig.missing_mb_album_id && !new_issue.missing_mb_album_id {
            field_matches.push(FieldMatch {
                field: "MB Album ID",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["MUSICBRAINZ ALBUM ID", "MUSICBRAINZ_ALBUMID", "MUSICBRAINZALBUMID", "MUSICBRAINZRELEASEID"]).unwrap_or_default(),
                category: "mb",
            });
        }

        // --- Discogs fields ---
        if orig.missing_discogs_artist && !new_issue.missing_discogs_artist {
            field_matches.push(FieldMatch {
                field: "Discogs Artist",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["URL_DISCOGS_ARTIST_SITE", "WWW DISCOGS_ARTIST"]).unwrap_or_default(),
                category: "discogs",
            });
        }
        if orig.missing_discogs_release && !new_issue.missing_discogs_release {
            field_matches.push(FieldMatch {
                field: "Discogs Release",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["URL_DISCOGS_RELEASE_SITE", "WWW DISCOGS_RELEASE"]).unwrap_or_default(),
                category: "discogs",
            });
        }

        // --- ID fields ---
        if orig.missing_acoustic_id && !new_issue.missing_acoustic_id {
            field_matches.push(FieldMatch {
                field: "Acoustic ID",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["ACOUSTIC_ID", "ACOUSTIC ID", "ACOUSTID_ID", "ACOUSTID ID"]).unwrap_or_default(),
                category: "ids",
            });
        }
        if orig.missing_songkong_id && !new_issue.missing_songkong_id {
            field_matches.push(FieldMatch {
                field: "SongKong ID",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["SONGKONG_ID", "SONGKONGID"]).unwrap_or_default(),
                category: "ids",
            });
        }
        if orig.missing_bandcamp && !new_issue.missing_bandcamp {
            field_matches.push(FieldMatch {
                field: "Bandcamp",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["URL_BANDCAMP_ARTIST_SITE", "WWW BANDCAMP_ARTIST"]).unwrap_or_default(),
                category: "ids",
            });
        }
        if orig.missing_wikipedia_artist && !new_issue.missing_wikipedia_artist {
            field_matches.push(FieldMatch {
                field: "Wikipedia Artist",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["WWW WIKIPEDIA_ARTIST"]).unwrap_or_default(),
                category: "ids",
            });
        }

        // --- Other fields ---
        if orig.missing_genre && !new_issue.missing_genre {
            field_matches.push(FieldMatch {
                field: "Genre",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["GENRE"]).unwrap_or_default(),
                category: "other",
            });
        }
        if orig.blank_genre && !new_issue.blank_genre {
            field_matches.push(FieldMatch {
                field: "Genre",
                old_display: "(blank)".into(),
                new_value: get_tag(&tag_map, &["GENRE"]).unwrap_or_default(),
                category: "other",
            });
        }
        if orig.missing_bpm && !new_issue.missing_bpm {
            field_matches.push(FieldMatch {
                field: "BPM",
                old_display: "Missing".into(),
                new_value: get_tag(&tag_map, &["BPM"]).unwrap_or_default(),
                category: "other",
            });
        }
        if orig.missing_mood && !new_issue.missing_mood {
            field_matches.push(FieldMatch {
                field: "Mood",
                old_display: "Missing".into(),
                new_value: "Present".into(),
                category: "other",
            });
        }
        if orig.missing_album_art && !new_issue.missing_album_art {
            field_matches.push(FieldMatch {
                field: "Album Art",
                old_display: "Missing".into(),
                new_value: "Embedded".into(),
                category: "other",
            });
        }

        if !field_matches.is_empty() {
            diffs.insert(orig.path.clone(), field_matches);
        }

        if new_issue.has_any_issue() {
            still_broken.push(new_issue);
        } else {
            matched.push(orig.path.clone());
        }
    }

    (matched, still_broken, unreadable, diffs, skipped_files)
}

// ---------------------------------------------------------------------------
// Quarantine helpers
// ---------------------------------------------------------------------------

fn restore_dir(staging_dir: &Path, scan_root: &str, moved: &mut u32, failed: &mut u32) {
    if !staging_dir.exists() {
        return;
    }

    println!("Moving files from {} back to original locations...", staging_dir.display());

    for entry in WalkDir::new(staging_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let src = entry.path();
        let rel = match src.strip_prefix(staging_dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let dst = PathBuf::from(scan_root).join(rel);

        if let Some(dst_parent) = dst.parent() {
            if let Err(e) = fs::create_dir_all(dst_parent) {
                eprintln!("  FAILED to create {}: {}", dst_parent.display(), e);
                *failed += 1;
                continue;
            }
        }

        match fs::rename(src, &dst) {
            Ok(_) => {
                println!("  Restored: {} -> {}", src.display(), dst.display());
                *moved += 1;
            }
            Err(e) => {
                eprintln!("  FAILED to move {}: {}", src.display(), e);
                *failed += 1;
            }
        }
    }

    remove_empty_dirs(staging_dir);
    let _ = fs::remove_dir(staging_dir);
}

fn end_quarantine(scan_root: &str) {
    let quarantine_dir    = PathBuf::from(scan_root).join("__QUARANTINE");
    let needs_review_dir  = PathBuf::from(scan_root).join("__NEEDS_REVIEW");
    let unreadable_dir    = PathBuf::from(scan_root).join("__UNREADABLE");
    let autofixed_dir     = PathBuf::from(scan_root).join("__AUTOFIXED");

    if !quarantine_dir.exists() && !needs_review_dir.exists()
        && !unreadable_dir.exists() && !autofixed_dir.exists()
    {
        println!("Nothing to do: no staging folders found.");
        return;
    }

    let mut moved = 0u32;
    let mut failed = 0u32;

    restore_dir(&quarantine_dir,   scan_root, &mut moved, &mut failed);
    restore_dir(&needs_review_dir, scan_root, &mut moved, &mut failed);
    restore_dir(&unreadable_dir,   scan_root, &mut moved, &mut failed);
    restore_dir(&autofixed_dir,    scan_root, &mut moved, &mut failed);

    println!("Done. Restored: {}, Failed: {}", moved, failed);
}

/// Recursively remove empty directories (deepest first).
fn remove_empty_dirs(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                remove_empty_dirs(&path);
                let _ = fs::remove_dir(&path); // silently fails if not empty
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let mut args = Args::parse();
    let scan_root = args.scan_path.trim_end_matches('/').to_string();

    if args.end_quarantine {
        end_quarantine(&scan_root);
        return;
    }

    println!("Audio Metadata Scanner");
    println!("======================");
    println!("Scan root : {}", scan_root);
    if !args.unc_prefix.is_empty() {
        println!("UNC prefix: {}", args.unc_prefix);
    }
    if args.limit > 0 {
        println!("Limit     : {} files", args.limit);
    }
    // Handle --autofix / --autofix-dry + --only-* interaction
    let do_autofix = args.autofix || args.autofix_dry;
    {
        let any_only = args.only_critical || args.only_mb || args.only_discogs
            || args.only_issues || args.only_ids || args.only_other;

        if do_autofix && any_only {
            println!("Autofix enabled, skipping --only-* commands");
            args.only_critical = false;
            args.only_mb       = false;
            args.only_discogs  = false;
            args.only_issues   = false;
            args.only_ids      = false;
            args.only_other    = false;
        } else if any_only {
            let mut modes = Vec::new();
            if args.only_critical { modes.push("critical"); }
            if args.only_mb       { modes.push("mb"); }
            if args.only_discogs  { modes.push("discogs"); }
            if args.only_issues   { modes.push("issues"); }
            if args.only_ids      { modes.push("ids"); }
            if args.only_other    { modes.push("other"); }
            println!("Pages     : {}", modes.join(", "));
        }
    }
    if args.autofix {
        println!("Autofix   : enabled (beets)");
    } else if args.autofix_dry {
        println!("Autofix   : dry run (beets --pretend)");
    }
    if args.no_report {
        println!("Report    : disabled");
    }
    if !args.only.is_empty() {
        println!("Filter    : only folders matching '{}'", args.only);
    } else if !args.from.is_empty() || !args.to.is_empty() {
        let from_str = if args.from.is_empty() { "A".to_string() } else { args.from.to_uppercase() };
        let to_str = if args.to.is_empty() { "Z".to_string() } else { args.to.to_uppercase() };
        println!("Filter    : {} to {}", from_str, to_str);
    }
    println!("CPU cores : {}", num_cpus::get());
    println!();

    let start = Instant::now();

    // --- Phase 1: Collect file paths ---
    println!("[1/4] Walking directory tree...");
    let extensions = ["mp3", "m4a", "opus", "aac", "ogg", "flac"];
    let total_dirs = AtomicU64::new(0);

    let limit = args.limit;
    let from_filter = args.from.to_lowercase();
    let to_filter = args.to.to_lowercase();
    let only_filter = args.only.to_lowercase();
    let scan_root_clone = scan_root.clone();

    let paths: Vec<PathBuf> = WalkDir::new(&scan_root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if e.file_type().is_dir() {
                total_dirs.fetch_add(1, Ordering::Relaxed);
                return false;
            }

            // Apply filters based on artist folder
            let folder = get_artist_folder(e.path(), &scan_root_clone);
            let folder_lower = folder.to_lowercase();

            // --only filter: starts with match (takes precedence)
            if !only_filter.is_empty() {
                if !folder_lower.starts_with(&only_filter) {
                    return false;
                }
            }
            // --from/--to filter: string range (lexicographic comparison)
            else if !from_filter.is_empty() || !to_filter.is_empty() {
                if !from_filter.is_empty() && folder_lower < from_filter {
                    return false;
                }
                if !to_filter.is_empty() {
                    let to_upper = format!("{}\u{10FFFF}", to_filter);
                    if folder_lower > to_upper {
                        return false;
                    }
                }
            }

            if let Some(ext) = e.path().extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                extensions.contains(&ext_lower.as_str())
            } else {
                false
            }
        })
        .map(|e| e.into_path())
        .take(if limit > 0 { limit } else { usize::MAX })
        .collect();

    let total_files = paths.len() as u64;
    let total_dirs = total_dirs.load(Ordering::Relaxed);
    println!("  Found {} audio files in {} folders", total_files, total_dirs);

    // --- Always build parent_audio_count (needed for issues.html and quarantine) ---
    let mut parent_audio_count: HashMap<PathBuf, usize> = HashMap::new();
    for p in &paths {
        if let Some(parent) = p.parent() {
            *parent_audio_count.entry(parent.to_path_buf()).or_insert(0) += 1;
        }
    }

    // --- Phase 2: Parallel scan ---
    println!("[2/4] Scanning metadata ({} threads)...", rayon::current_num_threads());
    let scanned = AtomicU64::new(0);

    // Lock-free accumulation via rayon fold/reduce.
    // Each thread builds its own local (issues, tag_keys, file_type_counts, total_size, error_count, unreadable_paths)
    // and they are merged at the end — no Mutex contention in the hot path.
    type ScanAcc = (Vec<FileIssue>, HashSet<String>, HashMap<String, u64>, u64, u64, Vec<(PathBuf, String)>);

    let (results, _all_tag_keys, file_type_counts, total_size, error_count, unreadable_paths): ScanAcc = paths
        .par_iter()
        .fold(
            || (Vec::<FileIssue>::new(), HashSet::<String>::new(), HashMap::<String, u64>::new(), 0u64, 0u64, Vec::<(PathBuf, String)>::new()),
            |mut acc, p| {
                let n = scanned.fetch_add(1, Ordering::Relaxed) + 1;

                // Progress: print every 10 000 files
                if n % 10_000 == 0 || n == total_files {
                    eprintln!("  ... scanned {}/{}", n, total_files);
                }

                // Track extension counts (thread-local, no lock needed)
                if let Some(ext) = p.extension() {
                    let mut ext_str = ext.to_string_lossy().into_owned();
                    ext_str.make_ascii_uppercase();
                    *acc.2.entry(ext_str).or_insert(0) += 1;
                }

                match scan_file(p) {
                    Ok((issue, tag_keys)) => {
                        acc.3 += issue.file_size;
                        acc.1.extend(tag_keys);
                        acc.0.push(issue);
                    }
                    Err(err) => {
                        acc.4 += 1;
                        acc.5.push((p.clone(), err.clone()));
                        eprintln!("  UNREADABLE: {} — {}", p.display(), err);
                    }
                }
                acc
            },
        )
        .reduce(
            || (Vec::new(), HashSet::new(), HashMap::new(), 0, 0, Vec::new()),
            |mut a, b| {
                a.0.extend(b.0);
                a.1.extend(b.1);
                for (k, v) in b.2 {
                    *a.2.entry(k).or_insert(0) += v;
                }
                a.3 += b.3;
                a.4 += b.4;
                a.5.extend(b.5);
                a
            },
        );

    println!("  Scanned {} files ({} errors)", results.len(), error_count);

    // --- Phase 3: Filter to only files with issues ---
    println!("[3/4] Filtering results...");
    let issues: Vec<FileIssue> = results
        .into_iter()
        .filter(|i| i.has_any_issue())
        .collect();

    println!("  {} files with at least one issue", issues.len());

    // --- Autofix: use beets to tag files with issues, then re-scan for diffs ---
    let autofix_data = if args.autofix {
        let skip_dirs = run_autofix(&issues, &scan_root, &parent_audio_count, false);
        println!("\n[4/5] Re-scanning files after autofix...");
        let result = compute_autofix_diffs(&issues, &skip_dirs);
        println!("  Matched: {} | Still broken: {} | Newly unreadable: {} | Diffs: {} files | Skipped: {} files",
            result.0.len(), result.1.len(), result.2.len(), result.3.len(), result.4.len());
        Some(result)
    } else {
        if args.autofix_dry {
            run_autofix(&issues, &scan_root, &parent_audio_count, true);
        }
        None
    };

    // --- Phase 4: Move files to staging folders (if requested) ---
    if args.quarantine || args.quarantine_dry {
        let scan_root_path = PathBuf::from(&scan_root);
        let dry = args.quarantine_dry;

        // Helper closure: move (or dry-run) a batch of files to a staging directory.
        let move_batch = |batch: &[PathBuf], staging_dir: &Path, label: &str, dry: bool| {
            if batch.is_empty() { return; }
            println!();
            if dry {
                println!("[DRY RUN] Would move {} file(s) to {}:", batch.len(), staging_dir.display());
                for src in batch {
                    let rel = src.strip_prefix(&scan_root_path).unwrap_or(src);
                    let dst = staging_dir.join(rel);
                    println!("  {} -> {}", src.display(), dst.display());
                }
            } else {
                println!("[Move] Moving {} file(s) to {}...", batch.len(), label);
                for src in batch {
                    let rel = src.strip_prefix(&scan_root_path).unwrap_or(src);
                    let dst = staging_dir.join(rel);
                    if let Some(dst_parent) = dst.parent() {
                        if let Err(e) = fs::create_dir_all(dst_parent) {
                            eprintln!("  FAILED to create {}: {}", dst_parent.display(), e);
                            continue;
                        }
                    }
                    match fs::rename(src, &dst) {
                        Ok(_) => println!("  Moved: {} -> {}", src.display(), dst.display()),
                        Err(e) => eprintln!("  FAILED to move {}: {}", src.display(), e),
                    }
                }
            }
        };

        if let Some(ref data) = autofix_data {
            // --- Autofix + quarantine: use pre-computed diffs ---
            let (ref matched_paths, ref still_broken, ref new_unreadable, _, _) = *data;

            let autofixed_dir    = scan_root_path.join("__AUTOFIXED");
            let quarantine_dir   = scan_root_path.join("__QUARANTINE");
            let needs_review_dir = scan_root_path.join("__NEEDS_REVIEW");
            let unreadable_dir   = scan_root_path.join("__UNREADABLE");

            // Matched files → __AUTOFIXED
            let mut sorted_matched = matched_paths.clone();
            sorted_matched.sort();
            move_batch(&sorted_matched, &autofixed_dir, "__AUTOFIXED", dry);

            // Still-broken files → __QUARANTINE or __NEEDS_REVIEW
            let mut to_quarantine:   Vec<PathBuf> = Vec::new();
            let mut to_needs_review: Vec<PathBuf> = Vec::new();
            for issue in still_broken {
                let count = issue.path.parent()
                    .and_then(|p| parent_audio_count.get(p))
                    .copied()
                    .unwrap_or(1);
                if count == 1 {
                    to_needs_review.push(issue.path.clone());
                } else {
                    to_quarantine.push(issue.path.clone());
                }
            }
            to_quarantine.sort();
            to_needs_review.sort();
            move_batch(&to_quarantine,   &quarantine_dir,   "__QUARANTINE",   dry);
            move_batch(&to_needs_review, &needs_review_dir, "__NEEDS_REVIEW", dry);

            // Unreadable files (original + newly unreadable after autofix) → __UNREADABLE
            let mut all_unreadable: Vec<PathBuf> = unreadable_paths.iter().map(|(p, _)| p.clone()).collect();
            all_unreadable.extend(new_unreadable.iter().map(|(p, _)| p.clone()));
            all_unreadable.sort();
            all_unreadable.dedup();
            move_batch(&all_unreadable, &unreadable_dir, "__UNREADABLE", dry);
        } else {
            // --- Standard quarantine (no autofix) ---
            let quarantine_dir   = scan_root_path.join("__QUARANTINE");
            let needs_review_dir = scan_root_path.join("__NEEDS_REVIEW");
            let unreadable_dir   = scan_root_path.join("__UNREADABLE");

            // Split issue files: lone files → __NEEDS_REVIEW, rest → __QUARANTINE
            let mut to_quarantine:   Vec<PathBuf> = Vec::new();
            let mut to_needs_review: Vec<PathBuf> = Vec::new();
            for issue in &issues {
                let count = issue.path.parent()
                    .and_then(|p| parent_audio_count.get(p))
                    .copied()
                    .unwrap_or(1);
                if count == 1 {
                    to_needs_review.push(issue.path.clone());
                } else {
                    to_quarantine.push(issue.path.clone());
                }
            }
            to_quarantine.sort();
            to_needs_review.sort();
            move_batch(&to_quarantine,   &quarantine_dir,   "__QUARANTINE",   dry);
            move_batch(&to_needs_review, &needs_review_dir, "__NEEDS_REVIEW", dry);

            // Unreadable files → __UNREADABLE
            let mut unreadable: Vec<PathBuf> = unreadable_paths.iter().map(|(p, _)| p.clone()).collect();
            unreadable.sort();
            move_batch(&unreadable, &unreadable_dir, "__UNREADABLE", dry);
        }
    }

    // --- Phase 5: Generate report ---
    if args.no_report {
        println!("\n[5/5] Report generation skipped (--no-report)");
    } else {
        println!("[5/5] Generating HTML report...");

        let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
        let output_dir = if args.output_dir.starts_with('/') {
            PathBuf::from(&args.output_dir)
        } else {
            std::env::current_dir()
                .unwrap_or_default()
                .join(&args.output_dir)
        };
        let report_dir = output_dir.join(format!("analysis_{}", timestamp));

        // Determine which pages to generate
        let any_only_flag = args.only_critical || args.only_mb || args.only_discogs
            || args.only_issues || args.only_ids || args.only_other;

        let pages = PageFlags {
            critical: !any_only_flag || args.only_critical,
            mb:       !any_only_flag || args.only_mb,
            discogs:  !any_only_flag || args.only_discogs,
            ids:      !any_only_flag || args.only_ids,
            other:    !any_only_flag || args.only_other,
        };

        let elapsed = start.elapsed();

        let diffs_ref = autofix_data.as_ref().map(|(_, _, _, d, _)| d);
        let skipped_ref = autofix_data.as_ref().map(|(_, _, _, _, s)| s);

        match generate_report(
            &issues,
            &paths,
            &parent_audio_count,
            &unreadable_paths,
            &scan_root,
            total_files,
            total_size,
            error_count,
            &file_type_counts,
            elapsed,
            &report_dir,
            &pages,
            diffs_ref,
            skipped_ref,
        ) {
            Ok(_) => {
                println!();
                println!("Report written to: {}", report_dir.display());
                println!("Total time: {:.2}s", elapsed.as_secs_f64());
                let readable = total_files.saturating_sub(error_count);
                let ok = readable.saturating_sub(issues.len() as u64);
                println!("Files OK: {} | Issues: {} | Unreadable: {}", ok, issues.len(), error_count);
            }
            Err(e) => {
                eprintln!("Failed to write report: {}", e);
                std::process::exit(1);
            }
        }
    }

    if args.autofix_dry {
        println!();
        println!("[Autofix DRY RUN] No files were modified. Run with --autofix to apply changes.");
    }
}
