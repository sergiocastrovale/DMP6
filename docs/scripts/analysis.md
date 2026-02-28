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
    ├── critical_1.html     ← missing/blank/invalid artist, title, year (page 1, 2, …)
    ├── mb_1.html           ← MusicBrainz artist/track/album IDs (page 1, 2, …)
    ├── discogs_1.html      ← Discogs artist URL, release URL (page 1, 2, …)
    ├── ids_1.html          ← Acoustic ID, SongKong ID, Bandcamp, Wikipedia (page 1, 2, …)
    └── other_1.html        ← Genre, BPM, Mood, Album Art (page 1, 2, …)
```

Each data page is split into multiple HTML files of 20 artists each (e.g. `mb_1.html`, `mb_2.html`, …) to keep file size manageable. Pagination controls appear at the top and bottom of each page. Each page has a navigation bar linking to all other pages, a search box, and subtab switching between fields.

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
| `--end-quarantine` | | Move all files from `__QUARANTINE`, `__NEEDS_REVIEW`, `__UNREADABLE`, and `__AUTOFIXED` back to their original locations. Removes empty directories left behind. Skips all scanning and report generation. |
| `--autofix` | | Use beets to auto-tag files with missing metadata. Requires `beet` installed with required plugins (see [Beets Setup](#beets-setup)). Runs after scan, before quarantine and report. When combined with `--only-*` flags, the `--only-*` flags are ignored (all pages generated). When combined with `--quarantine`, files are re-scanned after fix: fixed files go to `__AUTOFIXED`, remaining issues to `__QUARANTINE`/`__NEEDS_REVIEW`. |
| `--autofix-dry` | | Dry run of `--autofix`. Shows what beets would tag without writing to files (uses `beet import --pretend`). Same `--only-*` interaction as `--autofix` (flags are ignored). When combined with `--quarantine`, the standard (non-autofix) quarantine runs since no files were actually modified. |
| `--no-report` | | Skip report generation entirely. Useful when only quarantine is needed. |
| `--only-critical` | | Only generate `critical_N.html` pages + `index.html` + `issues.html`. |
| `--only-mb` | | Only generate `mb_N.html` pages + `index.html` + `issues.html`. |
| `--only-discogs` | | Only generate `discogs_N.html` pages + `index.html` + `issues.html`. |
| `--only-ids` | | Only generate `ids_N.html` pages + `index.html` + `issues.html`. |
| `--only-other` | | Only generate `other_N.html` pages + `index.html` + `issues.html`. |
| `-h, --help` | | Print help |

The `--only-*` page flags can be combined: `--only-mb --only-ids` generates `mb_N.html` + `ids_N.html` pages + `index.html` + `issues.html`. When no `--only-*` flags are set, all pages are generated. `index.html` and `issues.html` are always generated. **Note:** `--only-*` flags are ignored when `--autofix` or `--autofix-dry` is active (all pages are generated).

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

# Auto-fix dry run: see what beets would tag without writing anything
./analysis /mnt/c/__DMP --autofix-dry

# Auto-fix metadata with beets (scans then tags)
./analysis /mnt/c/__DMP --autofix

# Auto-fix only a specific artist, skip report
./analysis /mnt/c/__DMP --only="radiohead" --autofix --no-report

# Auto-fix a range of artists
./analysis /mnt/c/__DMP --from="a" --to="c" --autofix

# Auto-fix + quarantine: fixed files → __AUTOFIXED, remaining → __QUARANTINE
./analysis /mnt/c/__DMP --autofix --quarantine

# Auto-fix + quarantine dry run: see what would be moved after fixing
./analysis /mnt/c/__DMP --autofix --quarantine-dry --no-report

# --autofix with --only-mb: the --only-mb is ignored (all pages generated)
./analysis /mnt/c/__DMP --autofix --only-mb

# Restore all files from staging folders (including __AUTOFIXED) back to original locations
./analysis /mnt/c/__DMP --end-quarantine
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

### Phase 3b — Auto-fix with beets (optional)

Only runs when `--autofix` is passed.

1. Checks that `beet` is installed and in PATH. If not found, prints detailed installation instructions and exits.
2. Checks that `fpcalc` (chromaprint) is installed (required by the chroma plugin for AcoustID fingerprinting).
3. Verifies required beets plugins are loaded: `chroma`, `discogs`. Warns about recommended plugins: `bandcamp`, `fetchart`, `embedart`, `lastgenre`.
4. Groups files with issues by parent directory (album folder).
5. For each directory, runs `beet import -C -w -q <dir>` to attempt auto-tagging:
   - `-C`: don't copy/move files (tag in place)
   - `-w`: write tags to files
   - `-q`: quiet mode (no interactive prompts, skip uncertain matches)
6. Directories with only one audio file use singleton mode (`-s`).
7. Uses a temporary beet library (`/tmp/analysis_autofix_<pid>.db`) to avoid polluting the user's main beet database. Cleaned up after completion.

**What beets can match:**
- MusicBrainz IDs (artist, track, album/release)
- AcoustID fingerprint and ID
- Album art (via `fetchart` + `embedart` plugins)
- Genre (if `lastgenre` plugin is enabled)
- Discogs IDs (when matched via Discogs source)
- Bandcamp metadata (when matched via `bandcamp` plugin)

**What beets cannot match:**
- SongKong IDs (SongKong-specific)
- Wikipedia artist URLs (no standard beet plugin)
- BPM (requires separate analysis tools)
- Mood tags (requires separate analysis tools)

After autofix completes, the report shows both states inline — matched files appear with strikethrough and a check icon, beets skips appear with a warning icon. No re-run needed.

### Phase 4 — Move files to staging folders (optional)

Only runs when `--quarantine` or `--quarantine-dry` is passed.

**Without `--autofix`:** Files are split into three staging folders, all created inside the scan root:

- **`__QUARANTINE`** — files that could be read, have at least one metadata issue, and share their immediate parent folder with at least one other audio file.
- **`__NEEDS_REVIEW`** — files that could be read and have at least one metadata issue, but are the **only** audio file in their immediate parent folder. These are flagged separately because a lone file in a folder often indicates an incomplete or misplaced release rather than a simple tagging error.
- **`__UNREADABLE`** — files that could not be opened or parsed at all.

**With `--autofix`:** After autofix runs, all files from the original issue list are re-scanned to determine their post-match state. Files are split into four staging folders:

- **`__AUTOFIXED`** — files that originally had issues but are now fully clean after beets matching (all issues resolved).
- **`__QUARANTINE`** — files that still have issues after autofix and share their parent folder with other audio files.
- **`__NEEDS_REVIEW`** — files that still have issues after autofix and are the only audio file in their parent folder.
- **`__UNREADABLE`** — files that could not be opened or parsed (both from the original scan and any that became unreadable after autofix).

Each file is moved individually using a filesystem rename (fast, no copy), preserving its full relative path. Destination directories are created as needed. Files with no issues are never touched. With `--quarantine-dry` the planned moves are printed to stdout and nothing is changed.

Example:
- `Air/Albums/One/CD1/track01.mp3` (CD1 has 10 tracks) → `__QUARANTINE/Air/Albums/One/CD1/track01.mp3`
- `Air/Albums/One/CD1/one.mp3` (CD1 has only this one file) → `__NEEDS_REVIEW/Air/Albums/One/CD1/one.mp3`
- `Air/Albums/One/bad.mp3` (unreadable) → `__UNREADABLE/Air/Albums/One/bad.mp3`

### Phase 4b — Move files back from `__QUARANTINE` / `__NEEDS_REVIEW` / `__UNREADABLE` (optional)

Only runs when `--end-quarantine` is passed. Skips all scanning and report generation entirely.

Walks every file under `__QUARANTINE/`, `__NEEDS_REVIEW/`, `__UNREADABLE/`, and `__AUTOFIXED/`, strips the staging folder prefix to reconstruct each original path, creates any missing parent directories, and moves files back using a filesystem rename. After all files are restored, empty directories inside all staging folders are removed, along with the folders themselves if empty. Reverses `--quarantine`.

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

### critical_N.html, mb_N.html, discogs_N.html, ids_N.html, other_N.html

Each category is split across multiple pages of 20 artists each. Navigation links (`pages/mb_1.html`, etc.) always land on page 1. Pagination controls at the top and bottom of each page link to adjacent pages.

Each data page uses a **subtab + artist-grouped** layout:

- **Subtab bar** at the top — one tab per field (e.g., "MB Artist", "MB Track", "MB Album"). Each tab shows a count badge. When `--autofix` was used, matched files are shown as `N (-X)` where X is the number of files beets matched in that tab. Click to switch fields.
- **Artist groups** — files are grouped by top-level artist folder. Each group is collapsible (click the header). Multiple groups can be open simultaneously.
- **File list** — relative paths inside each artist group. Annotations appear inline where relevant:
  - `(blank)` — tag key exists but value is empty (Artist, Title, Genre, Year)
  - `(9999)` — invalid year value is shown in parentheses
  - `✓` — beets successfully matched this file; hover to see which fields were updated
  - `⚠` — beets attempted this file's directory but found no confident match; hover to see the reason
- **Search** — filters files within the active subtab panel. Matching artist groups auto-expand; non-matching groups are hidden.

Fields per page:

| Page | Subtabs |
|------|---------|
| `critical_N.html` | Artist, Title, Year |
| `mb_N.html` | MB Artist, MB Track, MB Album |
| `discogs_N.html` | Discogs Artist, Discogs Release |
| `ids_N.html` | Acoustic ID, SongKong, Bandcamp, Wikipedia |
| `other_N.html` | Genre, BPM, Mood, Album Art |

## What gets checked

### Categories

| Category | What it checks |
|---|---|
| **Critical** | Missing/blank `Artist`, `Title`, `Year`. Invalid year (0, 9999, negative, non-numeric). |
| **MusicBrainz** | Missing `MusicBrainz Artist Id` / `MUSICBRAINZ_ARTISTID`, `MusicBrainz Release Track Id` / `MUSICBRAINZ_TRACKID`, `MusicBrainz Album Id` / `MUSICBRAINZ_ALBUMID` / `MUSICBRAINZRELEASEID` |
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

## Beets Setup

The `--autofix` feature requires [beets](https://beets.io/) with specific plugins. This section covers complete setup from scratch.

### Install beets

```bash
pip install beets
```

### Install required plugins

```bash
# AcoustID fingerprinting (chroma plugin)
pip install pyacoustid

# Chromaprint fingerprinter (system package, provides fpcalc)
sudo apt install libchromaprint-tools

# Discogs metadata
pip install python-discogs-client
```

### Install recommended plugins

```bash
# Bandcamp metadata
pip install beets-bandcamp

# Last.fm genre tagging
pip install pylast
```

### Get API keys

| Service | URL | Used by |
|---------|-----|---------|
| AcoustID | https://acoustid.org/api-key | `chroma` plugin — fingerprint-based track identification |
| Discogs | https://www.discogs.com/settings/developers | `discogs` plugin — alternative metadata source |

### Configure beets

Create or edit `~/.config/beets/config.yaml`:

```yaml
# -------------------------
# Library
# -------------------------
directory: /mnt/c/__DMP      # Your music library root
library: ~/.config/beets/library.db

# -------------------------
# Plugins
# -------------------------
plugins:
  - chroma         # AcoustID fingerprinting (required)
  - discogs        # Discogs metadata (required)
  - fetchart       # Download album art (recommended)
  - embedart       # Embed art into files (recommended)
  - lastgenre      # Genre tagging from Last.fm (recommended)
  - bandcamp       # Bandcamp metadata (recommended)
  - info           # beet info command
  - scrub          # Clean junk tags
  - fromfilename   # Fallback: guess tags from filename

# -------------------------
# Import behavior
# -------------------------
import:
  write: yes          # Write tags to files
  move: no            # Don't move files
  copy: no            # Don't copy files
  autotag: yes        # Auto-match against MusicBrainz
  quiet: yes          # No interactive prompts
  resume: yes         # Resume interrupted imports
  log: ~/.config/beets/import.log

# -------------------------
# Matching
# -------------------------
match:
  strong_rec_thresh: 0.15
  medium_rec_thresh: 0.25
  preferred:
    countries: [US, GB, JP, XW]
    media: [CD, Digital Media, Vinyl]
    original_year: yes

# -------------------------
# AcoustID
# -------------------------
acoustid:
  apikey: YOUR_ACOUSTID_API_KEY

chroma:
  auto: yes

# -------------------------
# Discogs
# -------------------------
discogs:
  user_token: YOUR_DISCOGS_TOKEN
  append_style_genre: yes
  index_tracks: yes

# -------------------------
# Artwork
# -------------------------
fetchart:
  auto: yes
  cautious: yes
  minwidth: 600
  maxwidth: 2000
  sources:
    - coverart
    - itunes
    - amazon

embedart:
  auto: yes
  ifempty: no
  maxwidth: 1000

# -------------------------
# Genre
# -------------------------
lastgenre:
  auto: no           # Set to yes for automatic genre tagging
  source: album
  count: 3
```

### Verify installation

```bash
# Check beet is installed
beet version

# Expected output should list all plugins:
# beets version X.Y.Z
# plugins: bandcamp, chroma, discogs, embedart, fetchart, ...

# Check fpcalc is available
fpcalc -version

# Test on a small set
./analysis /mnt/c/__DMP --limit 10 --autofix --no-report
```

### How autofix uses beets

The `--autofix` flag runs `beet import` on each album directory containing files with issues. It uses a **temporary beet library** (`/tmp/analysis_autofix_<pid>.db`) so it does not modify your main beet database.

For each directory:
- Albums (multiple files in folder): `beet import -C -w -q <dir>`
- Singletons (lone files): `beet import -s -C -w -q <dir>`

In quiet mode, beets skips albums it cannot confidently match — no bad data is written. The report generated after autofix shows both states inline: files beets matched appear with strikethrough + `✓`, files beets skipped appear with `⚠`. No re-run is needed.

The `--autofix-dry` flag works identically but adds `--pretend` to the beet command, so no files are modified. It prints what beets *would* tag for each directory. Use this to preview autofix results before committing.
