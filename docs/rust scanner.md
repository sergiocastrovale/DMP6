# Audio Metadata Analysis Tool

A Rust CLI tool that scans millions of audio files for metadata issues and generates a dark-themed HTML report with tabbed views, search filtering, sortable columns, and dual WSL/Windows clickable links.

## Requirements

1. Fastest possible performance for 2M+ files
2. Supported formats: `mp3`, `m4a`, `opus`, `aac`, `ogg`, `flac`
3. Runs on Ubuntu inside WSL2
4. HTML report links handle both local and network (SMB/UNC) paths
5. Uses all CPU cores via rayon (thread pool, no contention)
6. Scales cleanly to millions of files

## Project location

```
scripts/analysis/     — Cargo project with src/main.rs
analysis              — Wrapper script in project root (executable)
```

Report output: `reports/metadata_analysis_[timestamp].html`

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
| `--unc-prefix <PREFIX>` | *(empty)* | UNC prefix for Windows links (e.g. `\\\\minibrain\\test`). When set, Windows links use this prefix instead of converting `/mnt/c/` to `C:\`. |
| `--output-dir <DIR>` | `../../reports` | Output directory for the HTML report. Can be relative (to the binary location) or absolute. |
| `--limit <N>` | `0` | Limit scan to the first N audio files. `0` = no limit (scan everything). Useful for testing on large libraries. |
| `--from <PREFIX>` | *(empty)* | Filter: only scan folders starting from this prefix (case insensitive). Supports multi-character prefixes. |
| `--to <PREFIX>` | *(empty)* | Filter: only scan folders up to and including this prefix (case insensitive). Use with `--from` to scan a specific range. |
| `--only <PREFIX>` | *(empty)* | Filter: only scan folders starting with this prefix (case insensitive). Takes precedence over `--from`/`--to`. |
| `-h, --help` | | Print help |

### Examples

```bash
# Using the wrapper script from project root
./analysis /mnt/c/__DMP
./analysis /mnt/c/__DMP --limit 500

# Or using the binary directly
cd scripts/analysis
./target/release/analysis /mnt/c/__DMP

# Full scan of a local path
./analysis /mnt/c/__DMP

# Scan with a file limit for testing
./analysis /mnt/c/__DMP --limit 500

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

# Scan an SMB mount with UNC prefix for Windows links
./analysis /mnt/minibrain/test --unc-prefix "\\\\minibrain\\test"

# Custom output directory
./analysis /mnt/c/__DMP --output-dir /home/kp/reports
```

## How it works

The scanner runs in 3 phases:

### Phase 1 — Walk directory tree

Uses `walkdir` to recursively collect all audio files (by extension) and count folders. 

**Optional filters:**
- `--only <PREFIX>`: Filters files where the artist folder name **starts with** the prefix (case insensitive). For example, `--only="t-"` only scans folders starting with "t-" like "T-Pain". Takes precedence over `--from`/`--to`.
- `--from <PREFIX>` / `--to <PREFIX>`: Filters files based on lexicographic string comparison of the artist folder name (case insensitive). Supports multi-character prefixes. For example, `--from="ta" --to="th"` scans folders from "Talking Heads" through "The Beatles" but not "Ti" or beyond.
- `--limit`: Stops collecting after N files.

Follows symlinks.

### Phase 2 — Parallel metadata scan

Uses `rayon` to distribute file reads across all CPU cores (auto-detected). Each file is opened with `lofty` (metadata parsing library). Tags from all containers in the file are collected into a single case-insensitive map. Progress is printed every 10,000 files.

Files that can't be opened or parsed are counted as "unreadable" and skipped.

### Phase 3 — Generate HTML report

Filters results to only files with at least one issue, then writes a self-contained HTML file with inline CSS and JS (no external dependencies).

## What gets checked

### Categories (report tabs)

| Tab | What it checks |
|---|---|
| **Critical** | Missing `Artist`, `Title`, `Year`, Invalid year (0, 9999, negative, non-numeric), Blank fields (tag key exists but value is empty/whitespace for Artist, Title, Year, Genre) |
| **API** | Missing `MusicBrainz Artist Id` / `MUSICBRAINZ_ARTISTID`, `MusicBrainz Release Track Id` / `MUSICBRAINZ_TRACKID`, `MusicBrainz Album Id` / `MUSICBRAINZ_ALBUMID`, `ACOUSTIC_ID` / `Acoustic ID`, `SONGKONG_ID` |
| **Secondary** | Missing `GENRE`, `BPM`, `URL_BANDCAMP_ARTIST_SITE` / `WWW BANDCAMP_ARTIST`, `URL_DISCOGS_ARTIST_SITE` / `WWW DISCOGS_ARTIST`, `URL_DISCOGS_RELEASE_SITE` / `WWW DISCOGS_RELEASE`, `WWW WIKIPEDIA_ARTIST`, any `MOOD_*` tag, embedded album art |
| **Fields** | Lists all unique metadata field names discovered across all scanned files (sorted alphabetically). Includes subtabs to filter by source: **All**, **MusicBrainz**, **Discogs**, **AcoustID**, **Wikipedia**, **SongKong**, and **Other**. Useful for finding duplicates, typos, and non-standard field names. |

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

## Report Features

The generated HTML report includes:

- **Dark theme** optimized for readability
- **Summary stats** showing:
  - File type breakdown (FLAC, MP3, M4A, etc.) with counts
  - Files OK, Files with Issues, Unreadable Files
  - Total size and scan time displayed in header
- **Tabbed interface** (Critical, API, Secondary, Fields)
- **Sortable columns** (click headers to sort)
- **Search filtering** (per-tab filter boxes)
- **Folder view toggle** (groups files by artist folder, shows counts and aggregated status)
- **Field subtabs** (in Fields tab: All, MusicBrainz, Discogs, AcoustID, Wikipedia, SongKong, iTunes-specific, Other)
  - Automatically groups fields by detecting lowercase substrings in field names
  - iTunes-specific: Fields starting with `----:COM.APPLE.ITUNES:`
  - `MOOD_*` fields are always placed in "Other" (excluded from AcoustID despite containing "acoustic")
  - Badge counts show number of fields in each category
  - When filtering/searching, automatically switches to "All" subtab
- **File links** (clickable paths that open in Windows Explorer via `file://` protocol)
- **Self-contained** (no external dependencies, all CSS/JS inline)

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
