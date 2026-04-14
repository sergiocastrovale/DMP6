# dmp-fix: Consolidated Metadata Repair Script

**Status**: Spec — not yet implemented

This document specifies a single Rust binary (`dmp-fix`) that replaces all of the following retired Python workaround scripts:

| Retired Script | What It Did |
|---|---|
| `fix_artist_names.py` | Fixed corrupted TPE2 + split compound artists + DB cleanup |
| `fix_compound_artists.py` | Album-specific compound artist splits |
| `fix_compound_tpe2.py` | Split ambiguous separators in TPE2 for non-MB artists |
| `fix_duplicates.py` | Merged duplicate Artist records with same normalized name |
| `fix_incomplete_metadata.py` | Derived missing title/album/year from folder & filename |
| `fix_sync_errors.py` | Fixed broken MP3 tags from `errors.log` (encoding, frames, APE) |
| `fix_unsplit_multiartist.py` | Split "feat."/"/"/";" albumArtist tags linked to single artist |
| `fix_tags.py` | Utility: applied tag changes across MP3/M4A/FLAC/OGG/Opus |
| `check_ampersand_artists.py` | Diagnostic: found compound artist folders needing splits |
| `missing_metadata_report.py` | Report: tracks missing mood/BPM/acousticID |

---

## Design Principles

1. **This is the ONLY script that modifies files on disk.** Neither `dmp-index` nor `dmp-sync` may write to the music filesystem — ever.
2. **Dry run by default.** All destructive operations require `--apply`.
3. **Idempotent.** Running it twice produces the same result.
4. **Scoped runs.** Filter by `--only "Artist Name"` or `--category corrupted,duplicates,missing`.
5. **Reports first, fixes second.** Always print what it found before offering to fix.
6. **DB cleanup included.** After fixing tags, clean up orphaned DB records so the next index run starts clean.

---

## CLI Interface

```
dmp-fix [OPTIONS]

OPTIONS:
  --apply                Actually write changes (default: dry run)
  --only <ARTIST>        Process only this artist (matched against albumArtist tags in files)
  --category <LIST>      Comma-separated categories to run (default: all)
                         Values: corrupted, missing, unsplit, duplicates, encoding, orphans, report
  --verbose              Show per-file detail
  --validate-mb          For unsplit category: validate proposed artist parts against MusicBrainz before splitting
  --errors-log <PATH>    Path to errors.log for encoding fixes (default: ./errors.log)
```

---

## Categories

### 1. `corrupted` — Fix Garbage in Album Artist Tags

**What**: Detect and fix TPE2/albumArtist values that are clearly wrong.

**Detection patterns** (all regex):
- `^\d{1,3}$` — bare track number (e.g. `"01"`, `"14"`)
- `^\d{1,3}\s*-\s*\w` — track number prefix (e.g. `"01 - Song Name"`)
- `^\d{4}$` — bare year (e.g. `"2007"`)
- `^\d{4}\s*-\s*.+\s+-\s+.+\s+-\s+` — full path leaked into tag
- `@\d{2,3}$` — bitrate suffix (e.g. `"@128"`)
- Starts with `"lbumArtist/"` — broken field name prefix

**Resolution chain** (first match wins, metadata only — never use folder names):
1. Majority vote: most common valid albumArtist across other tracks in the same release (matched by album + year tags)
2. Track artist tag: use the `artist` (TPE1) tag from the same file
3. TXXX:ARTISTS or TXXX:ALBUMARTIST from the same file
4. If all fallbacks fail: log a warning but do NOT derive from folder name

**Action**: Rewrite the TPE2/album_artist tag in the file.

### 2. `missing` — Report Tracks with Missing Core Metadata

**What**: Find tracks with `NULL`/empty title, album, artist, or year tags and report them.

**Important**: `dmp-fix` does NOT derive metadata from folder or file names. Folder structure is organizational, not authoritative. If a tag is empty, only other tags within the same file can provide fallback values.

**Fallback tag sources** (for `--apply` mode):
- **Artist**: albumArtist tag → TXXX:ARTISTS → TXXX:ALBUMARTIST. If all empty → report only, cannot fix.
- **Album**: TXXX:ALBUM, alternate album tag keys. If all empty → report only.
- **Title**: no reliable cross-tag fallback exists. Report only.
- **Year**: TDRC → TYER → TDRL → DATE. If all empty → report only.

**Action**: With `--apply`, writes any successful cross-tag fallbacks. For tracks where no tag-based fallback exists, prints a report of files needing manual attention.

### 3. `unsplit` — Split Compound Album Artist Tags

**What**: Find files where `albumArtist` contains multiple artists that should be split into the `\` separator format used by the indexer.

**Separator patterns** (in detection priority order):
- `feat.` / `ft.` / `featuring` / `Feat.` — including parenthesized: `"X (feat. Y)"`
- ` / ` — space-slash-space (reliable multi-artist signal)
- `; ` / `;` — semicolon
- ` & ` — ampersand (only if NOT in known-single-artists list)
- `, ` — comma (only if ALL resulting parts contain a space, to avoid "Last, First" and "10,000 Maniacs")
- ` w/ ` — "with" abbreviation
- ` - ` — hyphen between full names (only when each segment has >= 2 words)

**Known single artists list**: A static list of ~200 band names that contain separators and must NOT be split. Examples:
- `/`: AC/DC, GZA/Genius, Joy/Disaster, Mats/Morgan
- `&`: Simon & Garfunkel, Kool & the Gang, Earth Wind & Fire, Belle & Sebastian, Nick Cave & the Bad Seeds
- `,`: Hank Williams, Jr., Black Country, New Road

This list should be stored as a data file (TOML or similar), not hard-coded.

**MusicBrainz validation** (optional, with `--validate-mb`):
Before splitting, look up each proposed part in MusicBrainz. If a proposed part doesn't match any MB artist, skip the split and warn.

**Action**: Rewrite albumArtist tag with `\`-separated parts (e.g. `"A feat. B"` → `"A\\B"`).

### 4. `duplicates` — Report Duplicate Artists

**What**: Find Artist records in the DB with the same normalized name but different IDs.

**Normalization**: `LOWER(REPLACE(REPLACE(name, ' ', ''), '.', ''))` — collapse spaces, dots, and case.

**Skip rules**:
- Both artists have different MB IDs → confirmed different artists, skip
- One is a subset of the other's name and the longer one has "the" or "trio" etc. → likely different

**Output**: For each pair, show:
- Both names, IDs, track counts
- Which would be kept (higher track count = canonical)
- Releases that would be moved

**Action**: This category is **DB-only** (no file changes). With `--apply`:
1. Move all `LocalReleaseArtist` links from duplicate → canonical
2. Move all `TrackArtist` links from duplicate → canonical
3. Move all `MusicBrainzReleaseArtist` links from duplicate → canonical
4. Delete the duplicate Artist record
5. Recalculate totals for the canonical artist

### 5. `encoding` — Fix Broken File Encoding and Corrupt Tags

**What**: Process files listed in `errors.log` that failed during indexing due to tag corruption.

**Error types and fixes**:

| Error Pattern | Fix |
|---|---|
| `Invalid encoding` | Strip all tags, re-tag as ID3v2.4 UTF-8 using values from the stripped read |
| `Invalid item size` | Remux with ffmpeg: `ffmpeg -i input -c copy -map_metadata 0 output` |
| `Invalid MPEG frame` | Remux with ffmpeg (same command) |
| `APE UTF-8 error` | Strip APE tags only, keep ID3v2 |
| `Missing artist tag` | Derive artist from TXXX:ARTISTS, TXXX:ALBUMARTIST, or TPE2; write to TPE1 |

**Recovery for missing artist** (tag sources in priority order, metadata only):
1. `TXXX:ARTISTS` — multi-value artist field
2. `TXXX:ALBUM_ARTISTS` / `TXXX:ALBUMARTIST`
3. `TPE2` (albumArtist)
4. If ALL tag sources are empty → log warning, cannot auto-fix (never derive from folder name)

**Action**: Modify the files as described. For ffmpeg remux, write to temp file and replace original.

### 6. `orphans` — Database Cleanup

**What**: Remove phantom and orphaned records from the database. No file changes.

**Cleanup operations** (in order):
1. **Phantom artists**: names matching `^\d{1,3}$` or `@\d{2,3}$` — created by corrupted albumArtist tags
2. **Orphan artists**: no `LocalReleaseArtist` links to any release that has tracks
3. **Empty local releases**: releases with zero `LocalReleaseTrack` rows
4. **Orphan MB releases**: `MusicBrainzRelease` records with no `MusicBrainzReleaseArtist` links
5. **Orphan MB release artists**: `MusicBrainzReleaseArtist` links where the artist no longer exists
6. **Stale TrackArtist links**: `TrackArtist` records pointing to deleted artists or deleted tracks

**Action**: Delete the identified records. Print counts for each category.

### 7. `report` — Diagnostic Reports (No Changes)

**What**: Generate reports on metadata quality. Never modifies anything.

**Reports**:
- **Missing mood**: Tracks with no `mood` tag
- **Missing BPM**: Tracks with no `bpm` tag or `bpm = 0`
- **Missing Acoustic ID**: Tracks with no `acousticId`
- **Compound artist candidates**: Folders whose name contains `&`, `/`, `feat.` — cross-referenced with MB artist IDs to determine if they should be split
- **Unsplit albumArtist tags**: Releases linked to a single artist where the tag contains separator characters

**Output**: Printed summary with counts and optional `--verbose` per-file listing.

---

## Tag Writing Implementation

The script must support writing tags to all formats in the library:

| Format | Tag Type | Library |
|---|---|---|
| `.mp3` | ID3v2.4 | `lofty` or `id3` crate |
| `.m4a` / `.mp4` | MP4/iTunes atoms | `lofty` |
| `.flac` | Vorbis comments | `lofty` |
| `.ogg` | Vorbis comments | `lofty` |
| `.opus` | Opus/Vorbis comments | `lofty` |

**Tag field mapping** (logical name → per-format field):

| Logical | MP3 (ID3v2) | MP4 | FLAC/OGG/Opus |
|---|---|---|---|
| `title` | `TIT2` | `©nam` | `TITLE` |
| `artist` | `TPE1` | `©ART` | `ARTIST` |
| `albumArtist` | `TPE2` | `aART` | `ALBUMARTIST` |
| `album` | `TALB` | `©alb` | `ALBUM` |
| `year` | `TDRC` | `©day` | `DATE` |
| `trackNumber` | `TRCK` | `trkn` | `TRACKNUMBER` |

**Important**: For multi-value albumArtist splits, use the backslash `\` as the internal separator (e.g. `"Artist A\\Artist B"`). The indexer (`dmp-index`) will split on `\` to create separate artist records.

---

## Execution Order

When running all categories (default), they execute in this order:

1. `encoding` — Fix file-level corruption first so subsequent steps can read tags
2. `corrupted` — Fix garbage albumArtist values
3. `missing` — Fill in missing metadata
4. `unsplit` — Split compound artist tags
5. `orphans` — Clean up DB after tag fixes
6. `duplicates` — Merge duplicate artists after cleanup
7. `report` — Generate quality reports last

This order matters: encoding fixes must come before tag reading, tag fixes before DB cleanup, and DB cleanup before duplicate detection.

---

## Post-Fix Workflow

After running `dmp-fix --apply`:

1. `dmp-fix` automatically touches (bumps mtime of) the parent directory of every modified file so that `dmp-index --quick` detects the changes via its directory mtime pre-filter
2. Run `dmp-index --quick` to re-index the fixed files (change detection via content hash picks up the tag changes, and the bumped directory mtime ensures quick scan enters the right folders)
3. Run `dmp-sync` to re-sync any artists whose data changed (auto-targets via `lastIndexedAt > lastSyncedAt`)
4. Optionally run `dmp-fix --category report` to verify improvements

### Directory Mtime Bumping

When `dmp-fix --apply` modifies a file, modifying the file's content updates the file's own mtime but does NOT update the parent directory's mtime (directory mtime only changes on file add/remove/rename). Since `dmp-index --quick` uses directory mtime as a pre-filter, modified-in-place files would be invisible to quick scan.

**Solution**: After processing each folder, `dmp-fix` explicitly calls `utime()` / `futimens()` on the parent directory to bump its mtime to `now()`. This ensures the next `dmp-index --quick` enters that directory and re-scans its files.

This is a lightweight operation (one syscall per modified directory, not per file) and only affects directories that actually had files modified.

---

## Implementation Notes

- **Use `lofty` crate** for all tag reading/writing — it already supports all target formats and is the same library the indexer uses for reading.
- **ffmpeg dependency**: The `encoding` category requires `ffmpeg` on PATH for remuxing corrupt files.
- **NAS access**: When running against the production library, files are on a NAS mount. The script needs direct filesystem access to the music directory (`MUSIC_DIR` env var).
- **SSH remote execution**: The retired Python scripts used SSH (`subprocess.run(["ssh", ...])`) to modify files on the NAS remotely. The Rust script should do the same OR require running directly on the NAS. Recommend: run directly on the NAS via Docker (same pattern as `dmp-sync`).
- **Backup**: Consider writing a `.bak` copy of each modified file, or at minimum logging every change to a structured log file for rollback.
- **Error tolerance**: If a file can't be read/written, log it and continue. Never abort the full run for a single file failure.
