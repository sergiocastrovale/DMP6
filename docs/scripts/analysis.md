# Scripts: analysis

A Rust CLI tool that scans millions of audio files for metadata issues and generates a multi-page dark-themed HTML report with search filtering, sortable columns, and static tab navigation between pages.

## Requirements

1. Fastest possible performance for 2M+ files
2. Supported formats: `mp3`, `m4a`, `opus`, `aac`, `ogg`, `flac`
3. Runs on Ubuntu inside WSL2
4. Uses all CPU cores via rayon (thread pool, no contention)
5. Scales cleanly to millions of files

## Project location

```
scripts/analysis/     — Cargo project with src/main.rs
analysis              — Wrapper script in project root (executable)
```

## Report output

Reports are generated as a timestamped folder with multiple HTML pages:

```
reports/analysis_[timestamp]/
├── css/styles.css          ← shared dark-theme stylesheet
├── js/report.js            ← shared search + sort logic
├── index.html              ← synopsis dashboard
└── pages/
    ├── issues.html         ← needs-review (lone files) + unreadable files
    ├── critical.html       ← missing/blank/invalid artist, title, year
    ├── mb.html             ← MusicBrainz artist/track/album IDs
    ├── discogs.html        ← Discogs artist URL, release URL
    ├── ids.html            ← Acoustic ID, SongKong ID, Bandcamp, Wikipedia
    └── other.html          ← Genre, BPM, Mood, Album Art
```

Each page has a navigation bar linking to all other pages, a search box, and a flat sortable table showing only files with issues in that category.

`index.html` and `pages/issues.html` are **always generated** regardless of `--only-*` flags.

## CLI Reference

```
analysis [OPTIONS] <SCAN_PATH>
```

### Arguments

| Argument | Required | Description |
|---|---|---|
| `SCAN_PATH` | Yes | Root directory to scan for audio files |

### Options

| Flag | Default | Description |
|---|---|---|
| `--output-dir <DIR>` | `../../reports` | Output directory for the report folder. Can be relative (to the binary location) or absolute. |
| `--limit <N>` | `0` | Limit scan to the first N audio files. `0` = no limit (scan everything). Useful for testing on large libraries. |
| `--from <PREFIX>` | *(empty)* | Filter: only scan folders starting from this prefix (case insensitive). Supports multi-character prefixes. |
| `--to <PREFIX>` | *(empty)* | Filter: only scan folders up to and including this prefix (case insensitive). Use with `--from` to scan a specific range. |
| `--only <PREFIX>` | *(empty)* | Filter: only scan folders starting with this prefix (case insensitive). Takes precedence over `--from`/`--to`. |
| `--quarantine` | | After scanning, move every file with at least one metadata issue into `__QUARANTINE` or `__NEEDS_REVIEW` (see below), and every unreadable file into `__UNREADABLE`. All folders are created inside the scan root, preserving the full relative path of each file. |
| `--quarantine-dry` | | Dry run of `--quarantine`. Prints what would be moved to stdout without touching the filesystem. |
| `--end-quarantine` | | Move all files from `__QUARANTINE`, `__NEEDS_REVIEW`, and `__UNREADABLE` back to their original locations. Removes empty directories left behind in all three folders. Skips all scanning and report generation. |
| `--no-report` | | Skip report generation entirely. Useful when only quarantine is needed. |
| `--only-critical` | | Only generate `critical.html` + `index.html` + `issues.html`. |
| `--only-mb` | | Only generate `mb.html` + `index.html` + `issues.html`. |
| `--only-discogs` | | Only generate `discogs.html` + `index.html` + `issues.html`. |
| `--only-ids` | | Only generate `ids.html` + `index.html` + `issues.html`. |
| `--only-other` | | Only generate `other.html` + `index.html` + `issues.html`. |
| `-h, --help` | | Print help |

The `--only-*` page flags can be combined: `--only-mb --only-ids` generates `mb.html` + `ids.html` + `index.html` + `issues.html`. When no `--only-*` flags are set, all pages are generated. `index.html` and `issues.html` are always generated.

### Examples

```bash
# Using the wrapper script from project root
./analysis /mnt/c/__DMP
./analysis /mnt/c/__DMP --limit 500

# Or using the binary directly
cd scripts/analysis
./target/release/analysis /mnt/c/__DMP

# Scan only folders starting with A, B, or C
./analysis /mnt/c/__DMP --from="a" --to="c"

# Scan only folders starting with "The"
./analysis /mnt/c/__DMP --from="the" --to="the"

# Scan folders from "Ta" to "Th" (e.g., Talking Heads, The Beatles, etc.)
./analysis /mnt/c/__DMP --from="ta" --to="th"

# Scan only folders starting with "T-" (e.g., T-Pain, T-Rex)
./analysis /mnt/c/__DMP --only="t-"

# Scan only folders starting with "Pink" (Pink Floyd, etc.)
./analysis /mnt/c/__DMP --only="pink"

# Scan from M onwards
./analysis /mnt/c/__DMP --from="m"

# Custom output directory
./analysis /mnt/c/__DMP --output-dir /home/kp/reports

# Dry run: see which files would be moved to __QUARANTINE
./analysis /mnt/h/mp3 --quarantine-dry

# Move all files with issues into /mnt/h/mp3/__QUARANTINE/ (preserving path structure)
./analysis /mnt/h/mp3 --quarantine

# After fixing issues in __QUARANTINE, move files back to their original locations
./analysis /mnt/h/mp3 --end-quarantine

# Only generate the critical issues page
./analysis /mnt/c/__DMP --only-critical

# Generate only MusicBrainz and IDs pages
./analysis /mnt/c/__DMP --only-mb --only-ids

# Scan without generating a report
./analysis /mnt/c/__DMP --no-report --quarantine-dry
```

## How it works

The scanner runs in up to 5 phases:

### Phase 1 — Walk directory tree

Uses `walkdir` to recursively collect all audio files (by extension) and count folders. Builds a `parent_audio_count` map (parent directory → number of audio files) used for lone-file detection on the issues page and for quarantine routing.

**Optional filters:**
- `--only <PREFIX>`: Filters files where the artist folder name **starts with** the prefix (case insensitive). For example, `--only="t-"` only scans folders starting with "t-" like "T-Pain". Takes precedence over `--from`/`--to`.
- `--from <PREFIX>` / `--to <PREFIX>`: Filters files based on lexicographic string comparison of the artist folder name (case insensitive). Supports multi-character prefixes. For example, `--from="ta" --to="th"` scans folders from "Talking Heads" through "The Beatles" but not "Ti" or beyond.
- `--limit`: Stops collecting after N files.

Follows symlinks.

### Phase 2 — Parallel metadata scan

Uses `rayon` to distribute file reads across all CPU cores (auto-detected). Each file is opened with `lofty` (metadata parsing library). Tags from all containers in the file are collected into a single case-insensitive map. Progress is printed every 10,000 files.

Files that can't be opened or parsed are counted as "unreadable" with their error message preserved for the issues page.

### Phase 3 — Filter results

Keeps all files with at least one issue across any category (critical, MusicBrainz, Discogs, IDs, or other). Each report page further filters to its own category.

### Phase 4 — Move files to `__QUARANTINE` / `__NEEDS_REVIEW` / `__UNREADABLE` (optional)

Only runs when `--quarantine` or `--quarantine-dry` is passed.

Files are split into three staging folders, all created inside the scan root:

- **`__QUARANTINE`** — files that could be read, have at least one metadata issue, and share their immediate parent folder with at least one other audio file.
- **`__NEEDS_REVIEW`** — files that could be read and have at least one metadata issue, but are the **only** audio file in their immediate parent folder. These are flagged separately because a lone file in a folder often indicates an incomplete or misplaced release rather than a simple tagging error.
- **`__UNREADABLE`** — files that could not be opened or parsed at all.

Each file is moved individually using a filesystem rename (fast, no copy), preserving its full relative path. Destination directories are created as needed. Files with no issues are never touched. With `--quarantine-dry` the planned moves for all three folders are printed to stdout and nothing is changed.

Example:
- `Air/Albums/One/CD1/track01.mp3` (CD1 has 10 tracks) → `__QUARANTINE/Air/Albums/One/CD1/track01.mp3`
- `Air/Albums/One/CD1/one.mp3` (CD1 has only this one file) → `__NEEDS_REVIEW/Air/Albums/One/CD1/one.mp3`
- `Air/Albums/One/bad.mp3` (unreadable) → `__UNREADABLE/Air/Albums/One/bad.mp3`

### Phase 4b — Move files back from `__QUARANTINE` / `__NEEDS_REVIEW` / `__UNREADABLE` (optional)

Only runs when `--end-quarantine` is passed. Skips all scanning and report generation entirely.

Walks every file under `__QUARANTINE/`, `__NEEDS_REVIEW/`, and `__UNREADABLE/`, strips the staging folder prefix to reconstruct each original path, creates any missing parent directories, and moves files back using a filesystem rename. After all files are restored, empty directories inside all three staging folders are removed, along with the folders themselves if empty. Reverses `--quarantine`.

### Phase 5 — Generate multi-page HTML report

Generates a timestamped folder (`analysis_YYYYMMDD_HHMMSS/`) containing shared CSS/JS and multiple HTML pages. Skipped if `--no-report` is passed.

**Orchestration:**
1. Creates directory structure (`css/`, `js/`, `pages/`)
2. Writes `css/styles.css` (shared dark-theme stylesheet)
3. Writes `js/report.js` (search filtering, subtab switching, artist group toggling, column sorting for issues.html)
4. Writes `index.html` (synopsis dashboard with stats and category breakdown)
5. Always writes `pages/issues.html` (lone files + unreadable files — always relevant)
6. Writes remaining pages to `pages/` based on `--only-*` flags (all pages if no flags set)

## Report pages

### index.html (Overview)

- Summary stats: total files scanned, files OK, files with issues, unreadable count, scan duration, total size
- File type breakdown (MP3: X, FLAC: Y, etc.)
- Per-category breakdown table with issue counts and links to each page

### issues.html

Shows structural issues — not metadata problems:

| Path | Problem |
|------|---------|
| `Artist/Album/track.mp3` | Only one file |
| `Artist/Album/broken.mp3` | Could not read header: invalid ID3 tag |

- **Lone files**: audio files that are the only file in their parent directory (likely incomplete releases)
- **Unreadable files**: files that couldn't be parsed, shown with their error message

### critical.html, mb.html, discogs.html, ids.html, other.html

Each data page uses a **subtab + artist-grouped** layout:

- **Subtab bar** at the top — one tab per field (e.g., "MB Artist", "MB Track", "MB Album"). Each tab shows a count badge. Click to switch fields.
- **Artist groups** — files are grouped by top-level artist folder. Each group is collapsible (click the header). Multiple groups can be open simultaneously.
- **File list** — relative paths inside each artist group. Annotations appear inline where relevant:
  - `(blank)` — tag key exists but value is empty (Artist, Title, Genre, Year)
  - `(9999)` — invalid year value is shown in parentheses
- **Search** — filters files within the active subtab panel. Matching artist groups auto-expand; non-matching groups are hidden.

Fields per page:

| Page | Subtabs |
|------|---------|
| `critical.html` | Artist, Title, Year |
| `mb.html` | MB Artist, MB Track, MB Album |
| `discogs.html` | Discogs Artist, Discogs Release |
| `ids.html` | Acoustic ID, SongKong, Bandcamp, Wikipedia |
| `other.html` | Genre, BPM, Mood, Album Art |

## What gets checked

### Categories

| Category | What it checks |
|---|---|
| **Critical** | Missing/blank `Artist`, `Title`, `Year`. Invalid year (0, 9999, negative, non-numeric). |
| **MusicBrainz** | Missing `MusicBrainz Artist Id` / `MUSICBRAINZ_ARTISTID`, `MusicBrainz Release Track Id` / `MUSICBRAINZ_TRACKID`, `MusicBrainz Album Id` / `MUSICBRAINZ_ALBUMID` |
| **Discogs** | Missing `URL_DISCOGS_ARTIST_SITE` / `WWW DISCOGS_ARTIST`, `URL_DISCOGS_RELEASE_SITE` / `WWW DISCOGS_RELEASE` |
| **IDs** | Missing `ACOUSTIC_ID` / `Acoustic ID`, `SONGKONG_ID`, `URL_BANDCAMP_ARTIST_SITE` / `WWW BANDCAMP_ARTIST`, `WWW WIKIPEDIA_ARTIST` |
| **Other** | Missing/blank `GENRE`, missing `BPM`, any `MOOD_*` tag, embedded album art |
| **Issues** | Lone files (only one audio file in parent directory), unreadable files |

For fields with multiple possible tag names (e.g., `URL_DISCOGS_ARTIST_SITE` or `WWW DISCOGS_ARTIST`), the field is only flagged as missing if **none** of the variants exist.

For MOOD fields, any tag starting with `MOOD_` counts (e.g., `MOOD_HAPPY`, `MOOD_AGGRESSIVE`). Flagged if zero `MOOD_*` tags exist.

## Dependencies (Cargo.toml)

| Crate | Purpose |
|---|---|
| `lofty 0.22` | Audio metadata parsing (ID3, Vorbis, MP4, etc.) |
| `rayon 1.10` | Data-parallel iterators (thread pool) |
| `walkdir 2.5` | Recursive directory traversal |
| `clap 4.5` | CLI argument parsing (with derive macros) |
| `chrono 0.4` | Timestamp formatting |
| `html-escape 0.2` | HTML entity encoding for safe output |
| `num_cpus 1.16` | CPU core count detection |

Release profile: `opt-level = 3`, `lto = "thin"`, `codegen-units = 1` for maximum speed.

## Setup Instructions

### Install Rust (one-time)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Verify
rustc --version
cargo --version
```

### Build

```bash
cd scripts/analysis
cargo build --release
```

The binary is at `scripts/analysis/target/release/analysis`.
