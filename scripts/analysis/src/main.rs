use chrono::Local;
use clap::Parser;
use html_escape::encode_text;
use lofty::config::ParseOptions;
use lofty::prelude::*;
use lofty::probe::Probe;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
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
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct FileIssue {
    path: PathBuf,
    file_size: u64,
    // Missing field flags — true means MISSING / BAD
    // Critical
    missing_artist: bool,
    missing_title: bool,
    missing_year: bool,
    // API
    missing_mb_artist_id: bool,
    missing_mb_track_id: bool,
    missing_mb_album_id: bool,
    missing_acoustic_id: bool,
    missing_songkong_id: bool,
    // Secondary
    missing_genre: bool,
    missing_bpm: bool,
    missing_bandcamp: bool,
    missing_discogs_artist: bool,
    missing_discogs_release: bool,
    missing_wikipedia_artist: bool,
    missing_mood: bool,
    missing_album_art: bool,
    // Inconsistencies
    invalid_year: Option<String>,    // the bad value
    blank_artist: bool,
    blank_title: bool,
    blank_year: bool,
    blank_genre: bool,
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
            || self.blank_genre
    }
    fn has_api(&self) -> bool {
        self.missing_mb_artist_id
            || self.missing_mb_track_id
            || self.missing_mb_album_id
            || self.missing_acoustic_id
            || self.missing_songkong_id
    }
    fn has_secondary(&self) -> bool {
        self.missing_genre
            || self.missing_bpm
            || self.missing_bandcamp
            || self.missing_discogs_artist
            || self.missing_discogs_release
            || self.missing_wikipedia_artist
            || self.missing_mood
            || self.missing_album_art
    }
    fn has_any_issue(&self) -> bool {
        self.has_critical() || self.has_api() || self.has_secondary()
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
                other => format!("{:?}", other).to_uppercase(),
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

fn scan_file(path: &Path) -> Option<FileIssue> {
    let meta = fs::metadata(path).ok()?;
    let file_size = meta.len();

    let parse_opts = ParseOptions::new().read_properties(false);
    let tagged_file = match Probe::open(path).ok()?.options(parse_opts).read() {
        Ok(f) => f,
        Err(_) => return None,
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

    // --- API ---
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
        &["MUSICBRAINZ ALBUM ID", "MUSICBRAINZ_ALBUMID", "MUSICBRAINZALBUMID"],
    );
    let missing_acoustic_id = !has_tag(&tags, &["ACOUSTIC_ID", "ACOUSTIC ID", "ACOUSTID_ID", "ACOUSTID ID"]);
    let missing_songkong_id = !has_tag(&tags, &["SONGKONG_ID", "SONGKONGID"]);

    // --- Secondary ---
    let missing_genre = !has_tag(&tags, &["GENRE"]);
    let missing_bpm = !has_tag(&tags, &["BPM"]);
    let missing_bandcamp =
        !has_tag(&tags, &["URL_BANDCAMP_ARTIST_SITE", "WWW BANDCAMP_ARTIST"]);
    let missing_discogs_artist =
        !has_tag(&tags, &["URL_DISCOGS_ARTIST_SITE", "WWW DISCOGS_ARTIST"]);
    let missing_discogs_release =
        !has_tag(&tags, &["URL_DISCOGS_RELEASE_SITE", "WWW DISCOGS_RELEASE"]);
    let missing_wikipedia_artist = !has_tag(&tags, &["WWW WIKIPEDIA_ARTIST"]);
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

    Some(FileIssue {
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
        missing_genre,
        missing_bpm,
        missing_bandcamp,
        missing_discogs_artist,
        missing_discogs_release,
        missing_wikipedia_artist,
        missing_mood,
        missing_album_art,
        invalid_year,
        blank_artist,
        blank_title,
        blank_year,
        blank_genre,
    })
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

/// Format a path showing the last 3 components: "Albums/2014 - Album Name/track.mp3"
fn format_file_path(path: &Path) -> String {
    let components: Vec<_> = path.components().collect();
    
    if components.len() <= 3 {
        // If 3 or fewer components, show them all
        path.to_string_lossy().to_string()
    } else {
        // Show last 3 components
        let last3: Vec<_> = components.iter().rev().take(3).rev().collect();
        last3
            .iter()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/")
    }
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
// HTML report
// ---------------------------------------------------------------------------

fn icon(missing: bool) -> &'static str {
    if missing {
        "<span class=\"miss\">&cross;</span>"
    } else {
        "<span class=\"ok\">&check;</span>"
    }
}

fn generate_html_report(
    issues: &[FileIssue],
    scan_root: &str,
    unc_prefix: &str,
    total_files: u64,
    total_dirs: u64,
    total_size: u64,
    error_count: u64,
    elapsed: std::time::Duration,
    output_path: &Path,
) -> std::io::Result<()> {
    let readable_files = total_files.saturating_sub(error_count);
    let fail_count = issues.len() as u64;
    let ok_count = readable_files.saturating_sub(fail_count);

    let critical: Vec<&FileIssue> = issues.iter().filter(|i| i.has_critical()).collect();
    let api: Vec<&FileIssue> = issues.iter().filter(|i| i.has_api()).collect();
    let secondary: Vec<&FileIssue> = issues.iter().filter(|i| i.has_secondary()).collect();

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut f = fs::File::create(output_path)?;

    // --- HTML head ---
    write!(f, r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Audio Metadata Analysis</title>
<style>
:root {{
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
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    padding: 24px;
}}
.container {{ max-width: 100%; margin: 0 auto; }}
h1 {{
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 8px;
    color: var(--text);
}}
.subtitle {{ color: var(--text-dim); margin-bottom: 24px; font-size: 13px; }}
.stats-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
}}
.stat-card {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
}}
.stat-card .label {{ color: var(--text-dim); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }}
.stat-card .value {{ font-size: 22px; font-weight: 700; margin-top: 4px; }}
.stat-card .value.ok {{ color: var(--green); }}
.stat-card .value.fail {{ color: var(--red); }}
.stat-card .value.warn {{ color: var(--orange); }}
.stat-card .value.info {{ color: var(--blue); }}
.tabs {{
    display: flex;
    gap: 0;
}}
.tab {{
    padding: 10px 20px;
    cursor: pointer;
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
    user-select: none;
}}
.tab:hover {{ color: var(--text); }}
.tab.active {{
    color: var(--accent);
    border-bottom-color: var(--accent);
}}
.tab .badge {{
    background: var(--surface2);
    color: var(--text-dim);
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 11px;
    margin-left: 6px;
}}
.tab.active .badge {{
    background: var(--accent-dim);
    color: #fff;
}}
.tab-content {{ display: none; }}
.tab-content.active {{ display: block; }}
.table-wrap {{
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-top: 16px;
}}
table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}}
th {{
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
}}
th:hover {{ color: var(--text); }}
td {{
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
}}
tr:hover td {{ background: var(--surface); }}
a {{ color: var(--accent); text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.miss {{ color: var(--red); font-weight: 700; font-size: 15px; }}
.ok {{ color: var(--green); font-size: 15px; }}
.warn-text {{ color: var(--orange); font-size: 12px; }}
.links {{ display: flex; gap: 8px; }}
.links a {{
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11px;
    color: var(--text-dim);
}}
.links a:hover {{ color: var(--accent); border-color: var(--accent); }}
.search-box {{
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
    margin-bottom: -8px;
}}
.search-box input {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 6px 12px;
    font-size: 13px;
    width: 260px;
    outline: none;
}}
.search-box input:focus {{ border-color: var(--accent); }}
.empty-state {{
    text-align: center;
    padding: 48px;
    color: var(--text-dim);
    font-size: 15px;
}}
</style>
</head>
<body>
<div class="container">
<h1>Audio Metadata Analysis</h1>
<p class="subtitle">Generated {timestamp} &middot; Scanned <code>{scan_root}</code></p>

<div class="stats-grid">
<div class="stat-card"><div class="label">Directory</div><div class="value info">{scan_root_short}</div></div>
<div class="stat-card"><div class="label">Audio Files</div><div class="value info">{total_files}</div></div>
<div class="stat-card"><div class="label">Folders</div><div class="value info">{total_dirs}</div></div>
<div class="stat-card"><div class="label">Total Size</div><div class="value info">{total_size}</div></div>
<div class="stat-card"><div class="label">Scan Time</div><div class="value info">{elapsed}</div></div>
<div class="stat-card"><div class="label">Files OK</div><div class="value ok">{ok_count}</div></div>
<div class="stat-card"><div class="label">Files with Issues</div><div class="value fail">{fail_count}</div></div>
<div class="stat-card"><div class="label">Unreadable Files</div><div class="value warn">{error_count}</div></div>
</div>

<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border);">
<div class="tabs">
<div class="tab active" onclick="switchTab('critical')">Critical<span class="badge">{critical_count}</span></div>
<div class="tab" onclick="switchTab('api')">API<span class="badge">{api_count}</span></div>
<div class="tab" onclick="switchTab('secondary')">Secondary<span class="badge">{secondary_count}</span></div>
</div>
<div style="padding: 0 20px; display: flex; align-items: center; gap: 8px;">
<label style="font-size: 13px; color: var(--text-dim); cursor: pointer; user-select: none;">
<input type="checkbox" id="folderViewToggle" checked onchange="toggleFolderView()" style="margin-right: 6px; cursor: pointer;">
Show only folders
</label>
</div>
</div>
"#,
        timestamp = encode_text(&Local::now().format("%Y-%m-%d %H:%M:%S").to_string()),
        scan_root = encode_text(scan_root),
        scan_root_short = encode_text(scan_root),
        total_files = total_files,
        total_dirs = total_dirs,
        total_size = human_size(total_size),
        elapsed = format!("{:.2}s", elapsed.as_secs_f64()),
        ok_count = ok_count,
        fail_count = fail_count,
        critical_count = critical.len(),
        api_count = api.len(),
        secondary_count = secondary.len(),
        error_count = error_count,
    )?;

    // --- Critical tab ---
    write_tab_table(
        &mut f,
        "critical",
        true,
        &["Folder", "File", "Artist", "Title", "Year", "Invalid Year", "Blank Artist", "Blank Title", "Blank Year", "Blank Genre"],
        &critical,
        scan_root,
        unc_prefix,
        |issue| {
            let yr = if let Some(ref v) = issue.invalid_year {
                format!("<span class=\"warn-text\">{}</span>", encode_text(v))
            } else {
                icon(false).to_string()
            };
            vec![
                icon(issue.missing_artist).to_string(),
                icon(issue.missing_title).to_string(),
                icon(issue.missing_year).to_string(),
                yr,
                icon(issue.blank_artist).to_string(),
                icon(issue.blank_title).to_string(),
                icon(issue.blank_year).to_string(),
                icon(issue.blank_genre).to_string(),
            ]
        },
    )?;

    // --- API tab ---
    write_tab_table(
        &mut f,
        "api",
        false,
        &[
            "Folder",
            "File",
            "MB Artist",
            "MB Track",
            "MB Album",
            "Acoustic ID",
            "SongKong",
        ],
        &api,
        scan_root,
        unc_prefix,
        |issue| {
            vec![
                icon(issue.missing_mb_artist_id).to_string(),
                icon(issue.missing_mb_track_id).to_string(),
                icon(issue.missing_mb_album_id).to_string(),
                icon(issue.missing_acoustic_id).to_string(),
                icon(issue.missing_songkong_id).to_string(),
            ]
        },
    )?;

    // --- Secondary tab ---
    write_tab_table(
        &mut f,
        "secondary",
        false,
        &[
            "Folder",
            "File",
            "Genre",
            "BPM",
            "Bandcamp",
            "Discogs Art.",
            "Discogs Rel.",
            "Wikipedia",
            "Mood",
            "Album Art",
        ],
        &secondary,
        scan_root,
        unc_prefix,
        |issue| {
            vec![
                icon(issue.missing_genre).to_string(),
                icon(issue.missing_bpm).to_string(),
                icon(issue.missing_bandcamp).to_string(),
                icon(issue.missing_discogs_artist).to_string(),
                icon(issue.missing_discogs_release).to_string(),
                icon(issue.missing_wikipedia_artist).to_string(),
                icon(issue.missing_mood).to_string(),
                icon(issue.missing_album_art).to_string(),
            ]
        },
    )?;

    // --- JS ---
    write!(
        f,
        r#"
<script>
function switchTab(name) {{
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector('[onclick="switchTab(\'' + name + '\')"]').classList.add('active');
    document.getElementById('tab-' + name).classList.add('active');
}}
function filterTable(input, tabId) {{
    const filter = input.value.toLowerCase();
    
    // If user starts typing, disable folder view
    if (filter.length > 0) {{
        const toggle = document.getElementById('folderViewToggle');
        if (toggle && toggle.checked) {{
            toggle.checked = false;
            toggleFolderView();
        }}
    }}
    
    const rows = document.querySelectorAll('#tab-' + tabId + ' tbody tr');
    rows.forEach(row => {{
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(filter) ? '' : 'none';
    }});
}}
function toggleFolderView() {{
    const checked = document.getElementById('folderViewToggle').checked;
    document.querySelectorAll('.tab-content').forEach(tabContent => {{
        const rows = Array.from(tabContent.querySelectorAll('tbody tr'));
        if (checked) {{
            // Group files by folder and aggregate status
            const folderGroups = new Map();
            
            // Group rows by folder
            rows.forEach(row => {{
                const folder = row.getAttribute('data-folder');
                if (!folder) return;
                
                if (!folderGroups.has(folder)) {{
                    folderGroups.set(folder, []);
                }}
                folderGroups.get(folder).push(row);
            }});
            
            // Process each folder group
            folderGroups.forEach((groupRows, folder) => {{
                const firstRow = groupRows[0];
                const count = groupRows.length;
                
                // Store original content for first row cells
                for (let i = 0; i < firstRow.cells.length; i++) {{
                    const cell = firstRow.cells[i];
                    if (!cell.getAttribute('data-original')) {{
                        cell.setAttribute('data-original', cell.innerHTML);
                    }}
                }}
                
                // Update file count in File column (index 1)
                if (firstRow.cells[1]) {{
                    firstRow.cells[1].textContent = count + ' file' + (count !== 1 ? 's' : '');
                }}
                
                // Aggregate status columns (starting from index 2, after Folder and File)
                for (let colIdx = 2; colIdx < firstRow.cells.length; colIdx++) {{
                    // Check if ANY file in this folder has an issue (miss/cross)
                    let hasIssue = false;
                    groupRows.forEach(row => {{
                        if (row.cells[colIdx]) {{
                            const html = row.cells[colIdx].innerHTML;
                            if (html.includes('miss') || html.includes('&cross;') || html.includes('warn-text')) {{
                                hasIssue = true;
                            }}
                        }}
                    }});
                    
                    // Set aggregated status
                    if (firstRow.cells[colIdx]) {{
                        if (hasIssue) {{
                            firstRow.cells[colIdx].innerHTML = '<span class="miss">&cross;</span>';
                        }} else {{
                            firstRow.cells[colIdx].innerHTML = '<span class="ok">&check;</span>';
                        }}
                    }}
                }}
                
                // Show first row, hide others
                firstRow.style.display = '';
                for (let i = 1; i < groupRows.length; i++) {{
                    groupRows[i].style.display = 'none';
                }}
            }});
        }} else {{
            // Restore all rows with original content
            rows.forEach(row => {{
                row.style.display = '';
                for (let i = 0; i < row.cells.length; i++) {{
                    const cell = row.cells[i];
                    if (cell.getAttribute('data-original')) {{
                        cell.innerHTML = cell.getAttribute('data-original');
                    }}
                }}
            }});
        }}
    }});
}}
// Sorting
document.querySelectorAll('th[data-sort]').forEach(th => {{
    th.addEventListener('click', () => {{
        const table = th.closest('table');
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const idx = parseInt(th.dataset.sort);
        const asc = th.dataset.dir !== 'asc';
        th.dataset.dir = asc ? 'asc' : 'desc';
        rows.sort((a, b) => {{
            const av = a.cells[idx]?.textContent.trim() || '';
            const bv = b.cells[idx]?.textContent.trim() || '';
            return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        }});
        rows.forEach(r => tbody.appendChild(r));
    }});
}});
// Initialize folder view on page load
window.addEventListener('DOMContentLoaded', () => {{
    toggleFolderView();
}});
</script>
</div>
</body>
</html>"#
    )?;

    Ok(())
}

fn write_tab_table<F>(
    f: &mut fs::File,
    tab_id: &str,
    is_active: bool,
    headers: &[&str],
    issues: &[&FileIssue],
    scan_root: &str,
    _unc_prefix: &str,
    cell_fn: F,
) -> std::io::Result<()>
where
    F: Fn(&FileIssue) -> Vec<String>,
{
    let active_class = if is_active { " active" } else { "" };
    write!(
        f,
        r#"<div id="tab-{tab_id}" class="tab-content{active_class}">
<div class="search-box"><input type="text" placeholder="Filter files…" oninput="filterTable(this,'{tab_id}')"></div>
<div class="table-wrap"><table>
<thead><tr>"#,
    )?;

    for (i, h) in headers.iter().enumerate() {
        write!(f, "<th data-sort=\"{}\">{}</th>", i, h)?;
    }
    write!(f, "</tr></thead>\n<tbody>\n")?;

    if issues.is_empty() {
        write!(
            f,
            "<tr><td colspan=\"{}\" class=\"empty-state\">No issues found in this category</td></tr>\n",
            headers.len()
        )?;
    } else {
        for issue in issues {
            let artist_folder = get_artist_folder(&issue.path, scan_root);
            let file_path = format_file_path(&issue.path);

            write!(f, "<tr data-folder=\"{}\">", encode_text(&artist_folder))?;
            write!(
                f,
                "<td title=\"{}\">{}</td>",
                encode_text(&issue.path.to_string_lossy()),
                encode_text(&artist_folder)
            )?;
            write!(
                f,
                "<td title=\"{}\">{}</td>",
                encode_text(&issue.path.to_string_lossy()),
                encode_text(&file_path)
            )?;
            for cell in cell_fn(issue) {
                write!(f, "<td>{}</td>", cell)?;
            }
            write!(f, "</tr>\n")?;
        }
    }

    write!(f, "</tbody></table></div></div>\n")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let args = Args::parse();
    let scan_root = args.scan_path.trim_end_matches('/').to_string();
    let unc_prefix = args.unc_prefix.clone();

    println!("Audio Metadata Scanner");
    println!("======================");
    println!("Scan root : {}", scan_root);
    if !unc_prefix.is_empty() {
        println!("UNC prefix: {}", unc_prefix);
    }
    if args.limit > 0 {
        println!("Limit     : {} files", args.limit);
    }
    println!("CPU cores : {}", num_cpus::get());
    println!();

    let start = Instant::now();

    // --- Phase 1: Collect file paths ---
    println!("[1/4] Walking directory tree...");
    let extensions = ["mp3", "m4a", "opus", "aac", "ogg", "flac"];
    let total_dirs = AtomicU64::new(0);

    let limit = args.limit;
    let walker = WalkDir::new(&scan_root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if e.file_type().is_dir() {
                total_dirs.fetch_add(1, Ordering::Relaxed);
                return false;
            }
            if let Some(ext) = e.path().extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                extensions.contains(&ext_lower.as_str())
            } else {
                false
            }
        })
        .map(|e| e.into_path());

    let paths: Vec<PathBuf> = if limit > 0 {
        walker.take(limit).collect()
    } else {
        walker.collect()
    };

    let total_files = paths.len() as u64;
    let total_dirs = total_dirs.load(Ordering::Relaxed);
    println!("  Found {} audio files in {} folders", total_files, total_dirs);

    // --- Phase 2: Parallel scan ---
    println!("[2/4] Scanning metadata ({} threads)...", rayon::current_num_threads());
    let scanned = AtomicU64::new(0);
    let total_size = AtomicU64::new(0);
    let error_count = AtomicU64::new(0);
    let last_folder = Mutex::new(String::new());

    let results: Vec<FileIssue> = paths
        .par_iter()
        .filter_map(|p| {
            let n = scanned.fetch_add(1, Ordering::Relaxed) + 1;
            
            // Show progress every 100 files or when folder changes
            if n % 100 == 0 || n == 1 {
                if let Some(_parent) = p.parent() {
                    let folder = get_artist_folder(p, &scan_root);
                    let mut last = last_folder.lock().unwrap();
                    if *last != folder {
                        eprintln!("  ... scanning: {} ({}/{})", folder, n, total_files);
                        *last = folder;
                    } else if n % 1000 == 0 {
                        eprintln!("  ... scanned {}/{}", n, total_files);
                    }
                }
            }
            
            match scan_file(p) {
                Some(issue) => {
                    total_size.fetch_add(issue.file_size, Ordering::Relaxed);
                    Some(issue)
                }
                None => {
                    error_count.fetch_add(1, Ordering::Relaxed);
                    None
                }
            }
        })
        .collect();

    let total_size = total_size.load(Ordering::Relaxed);
    let error_count = error_count.load(Ordering::Relaxed);
    println!("  Scanned {} files ({} errors)", results.len(), error_count);

    // --- Phase 3: Filter to only files with issues ---
    println!("[3/3] Filtering results...");
    let issues: Vec<FileIssue> = results
        .into_iter()
        .filter(|i| i.has_any_issue())
        .collect();

    println!("  {} files with at least one issue", issues.len());

    // --- Phase 4: Generate report ---
    println!("[3/3] Generating HTML report...");

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let output_dir = if args.output_dir.starts_with('/') {
        PathBuf::from(&args.output_dir)
    } else {
        // Relative to the binary's current working directory
        std::env::current_dir()
            .unwrap_or_default()
            .join(&args.output_dir)
    };
    let output_path = output_dir.join(format!("metadata_analysis_{}.html", timestamp));

    let elapsed = start.elapsed();

    match generate_html_report(
        &issues,
        &scan_root,
        &unc_prefix,
        total_files,
        total_dirs,
        total_size,
        error_count,
        elapsed,
        &output_path,
    ) {
        Ok(_) => {
            println!();
            println!("Report written to: {}", output_path.display());
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
