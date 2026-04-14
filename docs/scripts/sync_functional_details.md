# Sync Script: Complete Functional Map

> **Purpose**: Exhaustive reference for refactoring `scripts/sync/src/main.rs` (5214 lines) into modular, split binaries. Every function, struct, edge case, and data dependency is documented. This is a machine-readable map — not user documentation.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Execution Flow (main)](#execution-flow-main)
3. [Structs and Types](#structs-and-types)
4. [Function Reference](#function-reference)
   - [Config & CLI](#config--cli)
   - [Metadata Extraction](#metadata-extraction)
   - [Path & Filter Helpers](#path--filter-helpers)
   - [Artist Tag Splitting](#artist-tag-splitting)
   - [Cover Art (Local)](#cover-art-local)
   - [Cover Art (Remote)](#cover-art-remote)
   - [Rate Limiting](#rate-limiting)
   - [MusicBrainz API Client](#musicbrainz-api-client)
   - [Name Matching](#name-matching)
   - [Artist Search (6-Step)](#artist-search-6-step)
   - [MB Data Fetching](#mb-data-fetching)
   - [Release Type Filtering](#release-type-filtering)
   - [S3 Operations](#s3-operations)
   - [DB: Indexing Operations](#db-indexing-operations)
   - [DB: MB Sync Operations](#db-mb-sync-operations)
   - [Nuke / Overwrite](#nuke--overwrite)
   - [Status Checking](#status-checking)
   - [Checkpoint / Resume](#checkpoint--resume)
   - [Post-Processing](#post-processing)
   - [Artist Image Download](#artist-image-download)
   - [External Image APIs](#external-image-apis)
   - [Statistics](#statistics)
5. [The Main Loop: Per-Folder Processing](#the-main-loop-per-folder-processing)
6. [Data Flow & Dependencies](#data-flow--dependencies)
7. [Shared State Across Iterations](#shared-state-across-iterations)
8. [Split Boundary Analysis](#split-boundary-analysis)
9. [Run Lock (Concurrent Execution Prevention)](#run-lock-concurrent-execution-prevention)
10. [Deletion Reconciliation & Cascading Cleanup](#deletion-reconciliation--cascading-cleanup)
11. [Edge Cases & Gotchas](#edge-cases--gotchas)
12. [DB Schema Changes Required](#db-schema-changes-required)
13. [Hard Constraint: Read-Only Filesystem](#hard-constraint-read-only-filesystem)
14. [Lessons from Helper Scripts](#lessons-from-helper-scripts-patterns-for-the-refactor)

---

## Architecture Overview

The current monolithic script interleaves index and sync per folder. **In the refactor, these become two independent binaries** with different execution models:

### `dmp-index` — Local File Indexer

```
Truly sequential: one folder at a time, process immediately, commit, move on.
Within each folder: parallel file discovery + metadata extraction.

For each folder in MUSIC_DIR (alphabetically):
  Quick mode: stat(folder) → skip if mtime unchanged
  Walk files (jwalk, parallel) → extract metadata (rayon, parallel)
  → change detection vs DB → batch upsert in transaction
  → deletion reconciliation → cover art → update totals
  → commit transaction → save checkpoint → next folder
```

**Design goals**:
- **Truly sequential**: Enter folder → process → commit → next. No two-pass approach, no pre-scanning the whole tree. Results appear in the DB as each folder completes.
- **Quick scan via directory mtime**: `--quick` checks each folder's mtime before entering it. If unchanged → skip (zero I/O for that folder). Only enters folders with new/removed/renamed files.
- **Content hash for re-tagged files**: `--quick` catches structural changes (add/remove) via dir mtime. Re-tagged files (mtime changed, dir mtime unchanged) are caught by content hash comparison when `--full` is used, or when `dmp-fix --apply` bumps the parent directory mtime (see `docs/scripts/metadata_fix.md`).
- **Resumable**: `--resume` restarts from the last successfully committed folder. Per-folder transactions ensure no partial state.
- **Parallel within each folder**: `jwalk` for directory walking + `rayon` for metadata extraction. Critical for NAS/SMB latency.
- **No separate manifest table**: `LocalReleaseTrack` already stores `filePath`, `fileSize`, and `mtime` — it IS the manifest. No duplicate state to maintain.

#### Quick Scan Detail (`--quick`)

```
folders = readdir(MUSIC_DIR).sort()                    // ~50K entries
folder_mtimes = load_all_folder_scans()                // SELECT * FROM FolderScan → HashMap
for folder in folders:
    if !matches_filter(folder): continue
    folder_mtime = stat(folder).mtime                  // 1 syscall
    stored_mtime = folder_mtimes.get(folder)           // from FolderScan table
    if stored_mtime && folder_mtime <= stored_mtime:
        continue                                       // skip: nothing added/removed
    // --- folder has changes, process it ---
    process_folder(folder)                             // same as full scan
    UPSERT FolderScan(folder, folder_mtime)            // persist to DB

// --- after main loop: detect entirely deleted folders ---
db_folders = query_distinct_folder_prefixes()          // SELECT DISTINCT folder prefix from LocalReleaseTrack
for db_folder in db_folders:
    if db_folder not in folders:                       // folder gone from disk
        cascade_delete_folder(db_folder)               // same cascade as per-folder deletion
        DELETE FROM FolderScan WHERE folderPath = db_folder
```

**What quick scan catches**: New files added, files removed, files renamed, new subfolders, removed subfolders. All of these bump the parent directory's mtime.

**What quick scan misses**: Files re-tagged in place (file mtime changes, but directory mtime does not). This is acceptable because:
1. `dmp-fix --apply` explicitly bumps parent directory mtime after modifying files
2. Manual re-tagging is rare; when needed, run `--full`
3. The trade-off is sub-second skip of unchanged folders vs. walking every file

**Storing folder mtimes**: Dedicated `FolderScan` table with one row per folder. Updated per-folder after processing. Loaded into a `HashMap<String, DateTime>` at startup.

```sql
CREATE TABLE "FolderScan" (
  "folderPath"  TEXT PRIMARY KEY,
  "mtime"       TIMESTAMP NOT NULL
);
```

#### Full Scan Detail (`--full`)

Same sequential loop, but skips the mtime check — enters every folder unconditionally. Change detection happens per-file via content hash comparison against existing `LocalReleaseTrack` rows.

#### Per-Folder Processing (both modes)

```
process_folder(folder):
    BEGIN TRANSACTION
    // --- parallel zone ---
    files = jwalk(folder, threads)             // parallel readdir + stat
    tracks = files.par_iter()
        .filter(is_audio_file)
        .map(extract_metadata)                 // parallel tag reading
        .collect()
    // --- sequential zone ---
    db_tracks = query_existing_tracks(folder)  // SELECT from LocalReleaseTrack
    (new, changed, unchanged, deleted) = diff(tracks, db_tracks)
    batch_upsert(new + changed)
    delete_removed_tracks(deleted)             // cascade: see Deletion Reconciliation
    handle_cover_art(folder)
    update_totals(folder_artists)
    update_lastIndexedAt(folder_artists)       // all artists linked to processed releases
    COMMIT TRANSACTION
    save_checkpoint(folder)
```

**Transaction safety**: All DB mutations for a folder are wrapped in a single transaction. If the process is killed mid-folder (SIGTERM, crash, power loss), the transaction rolls back and the folder is re-processed on `--resume`. The checkpoint is saved AFTER the commit, so it always points to the last fully completed folder.

#### Deletion Reconciliation (per-folder)

After processing a folder, the indexer compares files found on disk against `LocalReleaseTrack` rows for that folder:

```sql
SELECT "filePath" FROM "LocalReleaseTrack"
WHERE "filePath" LIKE :folder_prefix || '%'
```

Any DB path not found in the current walk → the file was deleted. Triggers the cascading cleanup (see Deletion Reconciliation section).

#### Parallel Directory Walking (jwalk)

For NAS/SMB over HDD:
- Each `stat()` is a network round-trip (~1ms on local LAN)
- Sequential stat of 10K files = ~10 seconds
- Parallel stat (8 threads) of 10K files = ~1.3 seconds
- TrueNAS/ZFS caches directory metadata in ARC (RAM), so parallel stat calls don't thrash the HDD
- The bottleneck is network round-trip latency, which parallelism directly amortizes

`jwalk` parallelizes `readdir` + `stat` across a work-stealing thread pool. Thread count matches `--threads` flag (default: all cores, typically 4–8 is optimal for network I/O).

#### SIGTERM Handling

The indexer installs a signal handler (via `tokio::signal` or `ctrlc` crate) that sets an `AtomicBool` shutdown flag. The main loop checks this flag after each folder:

```
for folder in folders:
    if shutdown_flag.load(): break
    process_folder(folder)  // transaction ensures atomicity
    save_checkpoint(folder)
// cleanup
release_scan_lock()
update_statistics()
```

If SIGTERM arrives mid-transaction, the transaction is NOT committed (the DB connection drops, PostgreSQL rolls back automatically). The checkpoint still points to the previous folder, so `--resume` re-processes the interrupted folder from scratch.

### `dmp-sync` — External API Syncer

```
For each artist matching filters (from DB):
  Search MB → fetch details → download artist image → fetch releases
  → fetch tracks → set match status → download release cover art
  Resolve compound TrackArtist names
  Sync extra artists discovered from compounds/credits
  Clean up empty ghost artists
```

**Design goals**:
- **100% DB-driven**: Queries artists from the DB. Zero filesystem access — no MUSIC_DIR, no reading files, no writing `folder.jpg`. All images saved to `web/public/img/` and/or S3 only.
- **Filterable**: `--from`, `--to`, `--only`, `--overwrite`, `--skip-artist-images`, `--skip-release-images`.
- **Rate-limited**: MusicBrainz API adaptive backoff. The bottleneck is API calls, not local I/O.
- **Auto-targets changed artists**: By default (no `--from`/`--to`/`--only`), syncs only artists where `lastIndexedAt > lastSyncedAt` (see Data Handoff below).

### Legacy Architecture (current monolith)

The current script interleaves both phases per folder:

```
For each folder in MUSIC_DIR:
  ┌─ INDEX PHASE (local files → DB)
  └─ SYNC PHASE (DB artists → MusicBrainz API)
```

**Key constraint**: The sync phase needs data produced by the index phase (artist IDs, release IDs, embedded MB hints). The index phase is purely local; the sync phase makes network calls.

### Global Mutable State

These caches/counters persist across all folder iterations:

| Variable | Type | Purpose |
|----------|------|---------|
| `artist_cache` | `HashMap<String, String>` | slug → artist DB ID |
| `release_cache` | `HashMap<String, String>` | groupKey → release DB ID |
| `genre_cache` | `HashMap<String, String>` | genre name → genre DB ID |
| `release_type_cache` | `HashMap<String, String>` | type slug → type DB ID |
| `synced_mb_ids` | `HashMap<String, String>` | MB artist ID → DB artist ID (tracks who's been synced this run) |
| `limiter` | `RateLimiter` | Adaptive delay state for MB API |
| `error_log` | `Mutex<File>` | Append-only error log file handle |
| Counters | `u64/u32` | `new_total`, `updated_total`, `skipped_total`, `db_error_total`, `scan_error_total`, `synced`, `failed_sync`, `partial_sync` |

---

## Execution Flow (main)

Lines 3111–5214. Sequential steps:

### Startup (lines 3111–3309)

1. **Parse CLI args** → `Args` struct (clap)
2. **Load config** → `Config` struct (dotenvy from `web/.env`)
3. **Resolve music dir**: `--test` overrides to `web/dump/test-artists/`
4. **Configure rayon thread pool** (if `--threads > 0`)
5. **Connect to PostgreSQL** (PgPool, max 20 connections)
6. **Load checkpoint** for `--resume` (from `Statistics.lastSyncedArtist` + `Statistics.lastSyncArgs`)
   - Restores `--from`/`--to`/`--only` from saved JSON if not provided on CLI
7. **Print run config** (music dir, filters, mode, threads)
8. **Create HTTP client** (reqwest, 30s timeout)
9. **Create RateLimiter**
10. **Ensure Statistics row** exists (`INSERT ... ON CONFLICT DO NOTHING`)
11. **Create S3 client** if `IMAGE_STORAGE` is `s3` or `both`
12. **Execute nuke** if `--overwrite` (calls `nuke_artists()`)
13. **Handle resume logic**: load or clear checkpoint, save current args
14. **Open error log** (`errors.log`, append mode)
15. **Load caches**: pre-populate `artist_cache` and `release_cache` from DB
16. **List and filter artist folders**: read `MUSIC_DIR`, apply `matches_filter()`, sort, apply `--resume` skip, apply `--limit`
17. **Create image directories** (`web/public/img/releases/`, `web/public/img/artists/`)

### Per-Folder Loop (lines 3381–5135)

See [The Main Loop](#the-main-loop-per-folder-processing) for full detail.

### Finalization (lines 5137–5214)

1. Print index summary (files, new, updated, skipped, errors)
2. Print sync summary (synced, partial, failed)
3. Call `update_statistics()` → upsert global stats
4. Call `clear_sync_progress()` → clear checkpoint
5. Print elapsed time and final counts
6. List failed artists with reasons

---

## Structs and Types

### `Args` — Current Monolith (lines 33–80)
CLI arguments via clap. Fields:
- `music_dir: Option<String>` — positional override for MUSIC_DIR
- `overwrite: bool` — nuke matching data, re-index, re-sync
- `from: String` — folder range start (case insensitive, default "")
- `to: String` — folder range end (case insensitive, default "")
- `only: String` — semicolon-separated prefixes (case insensitive, default "")
- `test: bool` — use `web/dump/test-artists/`
- `resume: bool` — continue from last checkpoint
- `skip_images: bool` — skip all image operations
- `threads: usize` — rayon thread count (0 = all cores)
- `limit: usize` — max folders to process (0 = no limit)
- `verbose: bool` — show skipped MB releases

### `IndexArgs` — Refactored `dmp-index`
```
dmp-index [MUSIC_DIR] [OPTIONS]

OPTIONS:
  --quick               Quick scan: only process folders whose mtime changed since last scan (default when triggered from web UI)
  --full                Full scan: walk every folder regardless of mtime
  --resume              Continue from last checkpoint (skips completed folders)
  --from <LETTER>       Folder range start (case insensitive)
  --to <LETTER>         Folder range end (case insensitive)
  --only <ARTISTS>      Semicolon-separated artist names/prefixes (case insensitive)
  --overwrite           Nuke local data for matched folders before re-indexing
  --dry-run             Show what --overwrite would delete without actually deleting (requires --overwrite)
  --test                Use test-artists/ directory
  --threads <N>         Thread count for jwalk + rayon (0 = all cores, default 8 for NAS)
  --limit <N>           Max folders to process (0 = no limit)
  --skip-images         Skip cover art extraction and folder image operations
```

If neither `--quick` nor `--full` is specified, default is `--full` (backward-compatible with current behavior). When triggered from the web UI, always use `--quick`.

**Execution model**: Folders processed **sequentially** in alphabetical order. After each folder completes, a checkpoint is saved. `--resume` skips all folders up to and including the last checkpointed folder. Within each folder, directory walking uses `jwalk` (parallel recursive walker) and metadata extraction uses rayon — both critical for NAS/SMB latency.

### `SyncArgs` — Refactored `dmp-sync`
```
dmp-sync [OPTIONS]

OPTIONS:
  --overwrite               Nuke MB data for matched artists, re-sync from scratch
  --dry-run                 Show what --overwrite would delete without actually deleting (requires --overwrite)
  --from <LETTER>           Artist name range start (case insensitive)
  --to <LETTER>             Artist name range end (case insensitive)
  --only <ARTISTS>          Semicolon-separated artist names (case insensitive, exact match)
  --skip-artist-images      Skip downloading/updating artist photos
  --skip-release-images     Skip downloading/updating release cover art from external APIs (CAA, etc.)
  --resume                  Continue from last checkpoint
  --verbose                 Show skipped MB releases and detailed matching output
```

**Execution model**: Queries artists from the DB. Zero filesystem dependency — no MUSIC_DIR needed. By default (no explicit filters), auto-targets artists where `lastIndexedAt > lastSyncedAt`. With `--from`/`--to`/`--only`, overrides the timestamp filter with explicit name matching. Rate-limited by MusicBrainz API. `--skip-artist-images` and `--skip-release-images` are independent — you can skip one without the other. `--only` accepts multiple artists separated by `;`.

### `TrackMeta` (lines 87–109)
Extracted metadata from a single audio file. Fields:
- `file_path: String` — relative to MUSIC_DIR
- `file_size: i64`, `mtime: NaiveDateTime`
- `title`, `artist`, `album_artist`, `album`: `Option<String>`
- `year: Option<i32>`, `genre: Option<String>`
- `track_number`, `disc_number`, `duration`, `bitrate`, `sample_rate`: `Option<i32>`
- `position: Option<String>` — raw position tag (not parsed)
- `content_hash: String` — MD5 of `artist|album_artist|album|title|year|track|disc|genre`
- `metadata_json: JsonValue` — all tags NOT in the standard fields
- `has_picture: bool` — whether embedded artwork exists
- `mb_album_id: Option<String>` — MUSICBRAINZ_ALBUMID / MUSICBRAINZ_RELEASEGROUPID tag
- `mb_album_artist_id: Option<String>` — MUSICBRAINZ_ALBUMARTISTID tag

### `Config` (lines 115–127)
Environment config. Fields: `music_dir`, `database_url`, `project_root`, `image_storage`, `s3_bucket`, `s3_region`, `s3_access_key`, `s3_secret_key`, `s3_endpoint`, `s3_public_url`, `fanart_api_key`.

### MusicBrainz API types (lines 205–303)
- `MbArtistSearchResult` — `{ artists: Vec<MbArtistMatch> }`
- `MbArtistMatch` — `{ id, name, score: Option<u32> }` — used pervasively as the identity token for a resolved artist
- `MbReleaseGroupList` — paginated response `{ release_groups, release_group_count, release_group_offset }`
- `MbReleaseGroup` — `{ id, title, primary_type, secondary_types, first_release_date }`
- `MbRelease` — `{ id, title, date, status, media }`
- `MbReleaseList` — `{ releases: Vec<MbRelease> }`
- `MbMedia` — `{ position, tracks }`
- `MbTrack` — `{ id, title, position, length }`
- `MbArtistDetail` — `{ id, name, relations, genres, tags }`
- `MbRelation` — `{ relation_type, url: Option<MbUrl> }`
- `MbUrl` — `{ resource: String }`
- `MbGenre` — `{ name, count }`
- `MbTag` — `{ name, count }`

### `RateLimiter` (lines 880–949)
Adaptive rate limiter for MusicBrainz API. State:
- `delay_ms: u64` — current delay between requests
- `min_delay: u64` (250ms), `max_delay: u64` (10000ms)
- `last_request: Instant`
- `remaining: Option<u64>` — X-RateLimit-Remaining header value
- `reset_at: Option<u64>` — X-RateLimit-Reset header value (epoch seconds)

### `MatchStatus` (lines 2509–2531)
Enum: `Complete`, `Incomplete`, `ExtraTracks`, `Missing`, `Unsyncable`, `Unknown`.
Method `as_str()` returns the DB enum string.

### `SavedSyncArgs` (lines 2648–2653)
Stored checkpoint args: `from`, `to`, `only` (all `String`).

---

## Function Reference

### Config & CLI

#### `load_config(music_dir_override: &Option<String>) -> Config` (lines 129–199)
**Purpose**: Load environment variables from `.env` file(s) and construct Config.
**Called by**: `main()` at startup.
**Logic**:
1. Try `web/.env` (relative), then `../../web/.env` (from `scripts/sync/`), then `$PROJECT_ROOT/web/.env`
2. `MUSIC_DIR`: CLI override > env var > panic
3. `DATABASE_URL`: required, panic if missing
4. `PROJECT_ROOT`: env var > auto-detect from CWD (handles running from `scripts/sync/`, `scripts/`, or project root)
5. `IMAGE_STORAGE`: defaults to `"local"`
6. S3 and Fanart.tv config: all optional

### Metadata Extraction

#### `sanitize_tag(s: &str) -> String` (lines 310–314)
**Purpose**: Strip control characters (NUL, C0/C1 control codes) from tag values.
**Called by**: `extract_metadata()` inside the tag iteration loop.
**Edge case**: Preserves all printable Unicode including emoji, CJK, etc.

#### `extract_metadata(path: &Path, music_dir: &str) -> Result<TrackMeta, String>` (lines 316–491)
**Purpose**: Read a single audio file and extract all metadata into `TrackMeta`.
**Called by**: Parallel `par_iter()` in the index phase (line 3447).
**Logic**:
1. `fs::metadata()` → file size + mtime
2. Open with lofty (relaxed parsing mode, read properties enabled)
3. Iterate ALL tags (multiple tag types possible per file):
   - Standard fields: title, artist, album, year, genre (first non-None wins)
   - Custom fields via `items()`: albumArtist, trackNumber, discNumber, position
   - MusicBrainz IDs: MUSICBRAINZ_ALBUMID, MUSICBRAINZ_RELEASEGROUPID, MUSICBRAINZ_ALBUMARTISTID (multiple key name variants, minimum 32 chars)
   - Embedded pictures detection
   - All non-standard tags → `metadata_json`
4. Audio properties: duration, bitrate, sample_rate
5. Content hash: MD5 of `artist|albumArtist|album|title|year|track|disc|genre` (all lowercased)
6. Path: strip `music_dir` prefix to get relative path

**Edge cases**:
- `trackNumber` may contain "3/12" format → splits on `/` and parses first part
- `discNumber` same split behavior
- MB IDs validated: must be non-empty AND >= 32 chars
- Tags with only control characters are sanitized to empty strings
- Multiple tag containers (ID3v2 + APE) → first non-None value wins for each field
- Excluded keys from `metadata_json`: ARTIST, TITLE, ALBUM, YEAR, DATE, GENRE, TRACKNUMBER, TRACK, DISCNUMBER, DISC, ALBUMARTIST, ALBUM_ARTIST, ALBUM ARTIST

### Path & Filter Helpers

#### `normalize_filter(s: &str) -> String` (lines 499–507)
**Purpose**: Normalize a name for filter comparison: lowercase, strip non-alphanumeric (keep whitespace), collapse whitespace.
**Called by**: `matches_filter()`.
**Example**: `"A.A. Bondy"` → `"aa bondy"`, `"070-shake"` → `"070shake"` (note: hyphens stripped, no space inserted).

#### `matches_filter(folder: &str, from: &str, to: &str, only: &str) -> bool` (lines 509–536)
**Purpose**: Determine if a folder name matches the CLI filter criteria.
**Called by**: Main loop folder listing (line 3318), `nuke_artists()` (line 2362).
**Logic**:
1. If `only` is non-empty: split by `;`, check if folder starts with any normalized prefix
2. If `from` is non-empty: folder must be >= from (normalized string comparison)
3. If `to` is non-empty: folder must be <= to + `\u{10FFFF}` (ensures "B" includes "Björk")

#### `strip_disc_subfolder(folder_path: &str) -> String` (lines 541–563)
**Purpose**: Strip trailing disc subfolder patterns from path.
**Called by**: Index phase per-track processing (line 3572).
**Matches**: `CD1`, `CD 1`, `Disc1`, `Disc 1`, `Disk1`, `Disk 1` (case insensitive, digits only after prefix).
**Example**: `"Ayreon/Albums/2008 - 01011001/CD1"` → `"Ayreon/Albums/2008 - 01011001"`

#### `build_group_key(mb_album_id, album_title, year, album_artist) -> String` (lines 567–586)
**Purpose**: Create deterministic dedup key for releases.
**Called by**: Index phase per-track processing (line 3584).
**Logic**:
1. If `mb_album_id` is non-empty → `"mb:{id}"`
2. Else → `"meta:{slugify(title)}:{year|0}:{slugify(artist)|unknown}"`

#### `make_slug(name: &str) -> String` (lines 1795–1805)
**Purpose**: Create URL-safe slug from artist name.
**Called by**: `ensure_artist()`, `ensure_artist_cached()`, and various places that need slugs.
**Edge case**: If `slugify()` produces empty string (e.g. artist "!!!"), falls back to `"artist-{md5(name)}"`.

### Artist Tag Splitting

#### `SPECIAL_MB_ARTIST_IDS` (lines 593–601)
Const array of 7 MB artist IDs that are not real artists (Various Artists, [anonymous], [data], [dialogue], [no artist], [traditional], [unknown]).

#### `is_various_artists(name: &str) -> bool` (lines 603–609)
**Called by**: `is_special_artist_name()`.
**Matches**: "various artists", "various", "va", and variants starting with "various artists," / "& " / "/ ".

#### `is_special_artist_name(name: &str) -> bool` (lines 611–614)
**Called by**: Index phase (line 3554), sync phase (line 3980), `split_artists()` (via `split_by_chars` closure).

#### `is_special_mb_artist(id: &str, name: &str) -> bool` (lines 616–618)
**Called by**: Artist search steps 1, 2, 5, 6 (filtering out special artists from results).

#### `split_artists(tag: &str) -> (Vec<String>, Vec<String>)` (lines 630–722)
**Purpose**: Split an artist tag into `(main_artists, featured_artists)`.
**Called by**: Index phase per-track (lines 3554, 3560).
**Algorithm**:
1. Regex split on `feat.`/`ft.`/`featuring` (with optional parenthesis) → separate main and featured parts
2. For each part, split by character-level delimiters:
   - Always: `//`, `\\`, `||`, `;`, `|`
   - Conditionally: `/` and `\` only when surrounded by spaces (`" / "`, `" \ "`)
   - Always: `vs.` / `vs` (via regex)
   - **Never**: `,` (preserves "10,000 Maniacs", "Crosby, Stills & Nash")
   - **Never**: `&` (ambiguous: "Simon & Garfunkel")
3. Deduplicate main artists (case-insensitive)
4. Remove featured artists that duplicate main artists
5. Filter out special artist names from both lists

### Cover Art (Local)

#### `extract_cover_art(path: &Path, output_path: &Path) -> bool` (lines 728–754)
**Purpose**: Extract embedded cover art from audio file, resize to 200×200, save as JPEG.
**Called by**: Index phase Step 4 (line 3784, via par_iter).
**Logic**: Open file with lofty (no properties, relaxed parsing), get first picture, decode with `image`, resize with Triangle filter, save.

#### `use_folder_image(folder_path: &Path, output_path: &Path) -> Option<&'static str>` (lines 758–777)
**Purpose**: Check for `cover.jpg`, `folder.jpg`, `front.jpg` (case variants) in a folder, resize and save.
**Called by**: Index phase Step 4b (line 3856), `download_artist_image()` fallback.
**Returns**: The filename found (e.g. `"cover.jpg"`) or None.

#### `use_artist_folder_image(artist_folder: &Path, output_path: &Path) -> bool` (lines 782–824)
**Purpose**: Find artist image from folder. Priority: `folder.jpg` > `cover.jpg` > any jpg/png in root.
**Called by**: `download_artist_image()` (lines 2782, 2851).
**Edge case**: Only scans root of artist folder, not subdirectories.

### Cover Art (Remote)

#### `download_cover_art(client, release_group_id, output_path, source_folder) -> Result<(bool, bool), String>` (lines 829–874)
**Purpose**: Download cover from Cover Art Archive, resize to 200×200, save.
**Called by**: Index phase Step 6 (line 5053).
**Returns**: `(downloaded: bool, wrote_folder_jpg: bool)`.
**Edge case**: Only writes `folder.jpg` if it doesn't already exist.
**Legacy note**: The monolith also writes full-resolution `folder.jpg` to the source folder as a cache. In the split, CAA downloads move to the **syncer** (which saves to `web/public/img/` and S3 only — no MUSIC_DIR access). The **indexer** handles local cover art via `extract_cover_art()` and `use_folder_image()` without calling CAA.

### Rate Limiting

#### `RateLimiter::new()` (lines 892–901)
Initial state: 500ms delay, 250ms min, 10s max.

#### `RateLimiter::wait(&mut self)` (lines 903–910)
**Purpose**: Sleep for the remaining time until effective_delay has passed since last request.
**Called by**: `mb_get()` before every request.

#### `RateLimiter::effective_delay(&self) -> u64` (lines 914–930)
**Purpose**: Compute actual delay based on rate-limit headers (if available) or adaptive delay_ms.
**Logic**:
- If `remaining <= 10`: use max_delay or spread across remaining window
- Otherwise: spread remaining requests over time left with 20% headroom
- Falls back to `self.delay_ms` if no headers

#### `RateLimiter::update_from_headers(&mut self, remaining, reset_at)` (lines 932–935)
**Called by**: `mb_get()` after every response (from X-RateLimit-Remaining / X-RateLimit-Reset headers).

#### `RateLimiter::on_success(&mut self)` (lines 937–941)
Reduce delay by 15% (multiply by 85/100), floored at min_delay.

#### `RateLimiter::on_rate_limit(&mut self)` (lines 943–949)
Double delay, cap at max_delay. Clear cached headers (stale after rate limit).

### MusicBrainz API Client

#### `mb_get(client, url, limiter) -> Result<String, String>` (lines 958–1021)
**Purpose**: Make authenticated GET to MusicBrainz API with retry logic.
**Called by**: All `mb_*` functions that hit the API.
**Logic**:
- Up to 10 attempts
- Calls `limiter.wait()` before each attempt
- Parses X-RateLimit headers from every response
- On 200: call `on_success()`, return body text
- On 503/429: call `on_rate_limit()`, exponential backoff (up to 60s), retry
- On other errors: return error immediately
- Headers: `User-Agent: "DMPv6/0.1.0"`, `Accept: application/json`

### Name Matching

#### `normalize_name(name: &str) -> String` (lines 1023–1032)
**Purpose**: Normalize for similarity comparison. Strips "the " prefix, keeps only alphanumeric + whitespace.
**Called by**: `names_are_similar()`, `is_likely_compound_of()`, `try_release_group_credits()`, tag filtering in step 4-6.

#### `names_are_similar(query: &str, result: &str) -> bool` (lines 1034–1078)
**Purpose**: Fuzzy name matching with Jaccard similarity.
**Called by**: `mb_search_artist()` (line 1130), `find_mb_match_with_fallback()` Step 2 (line 1189), tag filtering (line 1295), `try_release_group_credits()` validation (line 1378).
**Algorithm**:
1. Exact normalized match → true
2. Single-token names → false (require exact match)
3. Jaccard similarity (word-level intersection/union) < 0.5 → false
4. If one name is a proper subset of the other, extra words must all be noise words (and, the, of, a, etc.) — otherwise false (prevents "Crosby, Stills & Nash" matching "Crosby, Stills, Nash & Young")
5. Otherwise → true

#### `is_likely_compound_of(artist_name: &str, match_name: &str) -> bool` (lines 1083–1113)
**Purpose**: Detect if `artist_name` is a compound name that resolved to `match_name` (one of its components).
**Called by**: Sync phase (line 4016) after MB search returns a match.
**Logic**:
1. Same normalized names → false (simple variation, not compound)
2. Contains unambiguous separators (` vs `, ` vs. `, ` – `, ` // `, ` | `, ` x `, `\`) → true
3. Contains ` & `: check if match words are a proper subset of artist words → true (e.g. "10cc & Godley & Creme" → "Godley & Creme": `{godley,creme} ⊂ {10cc,godley,creme}`)
4. No separator found → false (name variation like "FŒHN" → "Fœhn Trio")

### Artist Search (6-Step)

#### `mb_search_artist(client, name, limiter) -> Result<Option<MbArtistMatch>, String>` (lines 1115–1131)
**Purpose**: Search MB for an artist by name (quoted phrase, limit 5, score >= 90 + name similarity).
**Called by**: Steps 3, 4, 6 of `find_mb_match_with_fallback()`.

#### `find_mb_match_with_fallback(client, pool, artist_id, artist_name, mb_hint_artist_id, mb_hint_album_id, limiter) -> Result<(Option<MbArtistMatch>, Vec<(String, MbArtistMatch)>), String>` (lines 1144–1349)
**Purpose**: Master artist resolution function. Returns `(primary_match, additional_matches)`.
**Called by**: Sync phase per-artist (line 4009).
**Steps**:

1. **Embedded MB album artist ID** (line 1154): Direct lookup via `mb_lookup_artist()`. Skips special artist IDs. Returns immediately on success.

2. **Embedded MB album ID** (line 1176): Lookup release group → get artist credits via `mb_lookup_release_group_artist()`. Filters out special artists. Finds the credit matching the searched artist name (by similarity). Returns primary + additional credits. If no credit matches the searched name, falls through (prevents "Bethzaida" getting "…and Oceans" when first credit doesn't match).

3. **Name search** (line 1217): `mb_search_artist(artist_name)`. Returns on match.

4. **Raw tag search** (lines 1226–1315): Queries DB for distinct `(artist_tag, albumArtist_tag, album_title)` from tracks linked to this artist. Builds deduplicated tag list. Filters tags to only those related to artist_name (containment or similarity). Searches each tag variant on MB. Saves result as `early_primary` (candidate) but does NOT return — continues to steps 5-6.

5. **Release-group credits** (lines 1321–1329): For each `(tag, album_title)` pair, calls `try_release_group_credits()`. Uses MB's structured artist-credit array to resolve compound names without string splitting.

6. **Split compound tags** (lines 1334–1340): For each tag, calls `try_split_tag()`. Splits by unambiguous separators and searches each part.

7. **Fallback**: If step 4 found something but steps 5-6 didn't improve, returns `early_primary`.

#### `try_release_group_credits(client, album_title, artist_tag, early_primary, limiter)` (lines 1353–1416)
**Purpose**: Step 5 helper. Searches MB for release-group by title+artist, returns artist credits.
**Validation**: At least one credit must be related to `artist_tag` (containment or similarity). Prevents false matches.
**Returns**: `Some((primary, additional))` if credits provide new info beyond `early_primary`, None otherwise.

#### `try_split_tag(client, tag, artist_name, early_primary, limiter)` (lines 1423–1499)
**Purpose**: Step 6 helper. Split a compound tag by separators, search each part.
**Separator order** (tried longest-first):
- Always: `// `, `//`, `\\ `, `\\`, `|| `, `||`, ` feat. `, ` feat `, ` vs. `, ` vs `, ` – `, ` / `, ` \ `, `\`, `| `, `|`, `; `, `;`
- Only when `early_primary` exists: `/`, ` & `, `, ` (ambiguous separators — having a confirmed anchor makes these safe)
**Edge case**: If `artist_name` appears as one of the split parts, skip that separator (the other parts are different artists).

### MB Data Fetching

#### `mb_lookup_artist(client, mb_artist_id, limiter) -> Result<MbArtistMatch, String>` (lines 1503–1520)
Direct lookup: `/artist/{id}?fmt=json`. Returns `MbArtistMatch` with score=100.

#### `mb_lookup_release_group_artist(client, mb_release_group_id, limiter) -> Result<Vec<MbArtistMatch>, String>` (lines 1523–1550)
Lookup: `/release-group/{id}?inc=artist-credits&fmt=json`. Returns all artist credits.

#### `mb_search_release_group_credits(client, album_title, artist_name, limiter) -> Result<Vec<MbArtistMatch>, String>` (lines 1555–1599)
Search: `/release-group/?query=releasegroup:"..." AND artist:"..."&limit=1&fmt=json`. Returns artist credits if score >= 80.

#### `mb_get_artist_detail(client, mb_id, limiter) -> Result<MbArtistDetail, String>` (lines 1601–1612)
Fetch: `/artist/{id}?inc=url-rels+genres+tags&fmt=json`. Returns full artist detail with relations, genres, tags.

#### `mb_get_release_groups(client, mb_id, limiter) -> Result<Vec<MbReleaseGroup>, String>` (lines 1614–1643)
**Purpose**: Fetch ALL release groups for an artist (paginated, 100 per page).
**Called by**: Sync phase step 3 (line 4384), extra artist sync (line 4830).

#### `mb_get_release_tracks(client, release_group_id, limiter) -> Result<Vec<(MbRelease, Vec<MbTrack>)>, String>` (lines 1645–1685)
**Purpose**: Fetch releases for a release group, filter to Official only, collect tracks across all media.
**Called by**: Sync phase step 3 (line 4486), extra artist sync (line 4886).
**Edge case**: Skips non-Official releases (Bootleg, Promotional, etc.).

### Release Type Filtering

#### `should_skip_release(rg: &MbReleaseGroup) -> Option<String>` (lines 1691–1709)
**Purpose**: Determine if a release group should be skipped.
**Skip types**: Single, Bootleg, Demo, Interview, Broadcast.
**Checked in**: both `primary_type` and `secondary_types`.
**Returns**: The skip reason string, or None if should process.

### S3 Operations

#### `create_s3_client(config) -> Option<S3Client>` (lines 1715–1740)
Creates AWS S3 client from config. Returns None if bucket/region not configured.

#### `upload_to_s3(client, bucket, key, file_path) -> Result<(), Error>` (lines 1742–1758)
Upload a file to S3 with `content-type: image/jpeg`.

#### `delete_from_s3(client, bucket, key)` (lines 1760–1762)
Delete an object from S3. Ignores errors.

#### `upload_release_image_to_s3(s3_client, bucket, public_url, pool, release_id, file_path) -> bool` (lines 1765–1789)
Upload release image to S3, update `LocalRelease.imageUrl` in DB. Returns success.

### DB: Indexing Operations

#### `ensure_artist(pool, name) -> Result<String, sqlx::Error>` (lines 1807–1829)
**Purpose**: Insert artist or return existing ID (upsert on `slug` unique constraint).
**Returns**: Artist DB ID.
**Edge case**: Returns empty string if slug is empty (shouldn't happen due to `make_slug` fallback).

#### `ensure_artist_cached(pool, name, cache) -> Result<String, sqlx::Error>` (lines 1831–1850)
Cache wrapper around `ensure_artist()`. Checks cache by slug first.

#### `ensure_local_release(pool, title, year, folder_path, group_key) -> Result<String, sqlx::Error>` (lines 1852–1879)
**Purpose**: Insert local release or return existing ID (upsert on `groupKey` unique constraint).
**On conflict**: Updates `year` (COALESCE with existing) and `updatedAt`.
**Returns**: Release DB ID.

#### `ensure_local_release_cached(pool, title, year, folder_path, group_key, cache)` (lines 1881–1896)
Cache wrapper around `ensure_local_release()`. Checks cache by groupKey.

#### `batch_upsert_tracks(pool, tracks: &[(&TrackMeta, String)]) -> Result<HashMap<String, String>, sqlx::Error>` (lines 1898–2001)
**Purpose**: Batch insert/update tracks using UNNEST arrays.
**Called by**: Index phase (line 3723).
**On conflict** (`filePath`): Updates all metadata fields except `playCount` and `createdAt`.
**Returns**: `HashMap<filePath, trackId>` — needed to resolve pending TrackArtist links (which reference file paths, not DB IDs, before this call).

#### `batch_ensure_track_artists(pool, links: &[(trackId, artistId, role)])` (lines 2003–2043)
**Purpose**: Batch insert TrackArtist junction records via UNNEST.
**On conflict** (`trackId, artistId, role`): DO NOTHING.

#### `batch_ensure_local_release_artists(pool, links: &[(releaseId, artistId)])` (lines 2310–2334)
**Purpose**: Batch insert LocalReleaseArtist junction records via UNNEST.
**On conflict** (`localReleaseId, artistId`): DO NOTHING.

### DB: MB Sync Operations

#### `ensure_release_type(pool, name) -> Result<String, sqlx::Error>` (lines 2049–2067)
Upsert ReleaseType by slug. `ensure_release_type_cached()` (lines 2084–2096) is the cache wrapper.

#### `ensure_genre(pool, name) -> Result<String, sqlx::Error>` (lines 2069–2082)
Upsert Genre by name. `ensure_genre_cached()` (lines 2098–2109) is the cache wrapper.

#### `upsert_mb_release(pool, title, type_id, year, mb_id) -> Result<String, sqlx::Error>` (lines 2111–2139)
**Purpose**: Insert MusicBrainzRelease or update type/year on conflict (`musicbrainzId` unique).
**Returns**: Internal release ID.

#### `ensure_mb_release_artist_link(pool, release_id, artist_id)` (lines 2141–2158)
Insert MusicBrainzReleaseArtist junction. On conflict DO NOTHING.

#### `batch_insert_mb_tracks(pool, release_id, tracks, disc_number)` (lines 2160–2210)
Batch insert MusicBrainzReleaseTrack records via UNNEST. On conflict DO NOTHING.

#### `delete_mb_tracks_for_release(pool, release_id) -> Result<u64, sqlx::Error>` (lines 2212–2223)
Delete all MB tracks for a release. Called before re-inserting (replace strategy).

#### `get_existing_mb_release_tracks(pool, mb_release_group_id) -> Option<(String, Vec<(String, Option<i32>)>)>` (lines 2227–2254)
**Purpose**: Check if an MB release group already has tracks in DB. Used to skip API calls.
**Returns**: `(internal_release_id, tracks)` or None.

#### `batch_link_artist_genres(pool, artist_id, genre_ids)` (lines 2257–2276)
Batch insert `_ArtistGenres` junction via UNNEST.

#### `batch_upsert_artist_urls(pool, artist_id, urls: &[(type, url)])` (lines 2279–2307)
Batch insert ArtistUrl records via UNNEST. On conflict (`artistId, type, url`) DO NOTHING.

### Nuke / Overwrite

#### `nuke_artists(pool, from, to, only, project_root, s3_client, config) -> Result<u64, sqlx::Error>` (lines 2340–2503)
**Purpose**: Delete all matching artists and their cascading data.
**Called by**: Main startup when `--overwrite` (line 3227).
**Algorithm**:
1. Find target artist IDs by name matching (not slug — important for "...And Oceans" etc.)
2. Find ALL releases linked to target artists
3. Find ALL artists linked to those releases (catches co-artists on shared releases)
4. Combine into `nuke_list` (union of targets + co-artists)
5. Collect and delete images (local files + S3 objects)
6. Delete LocalRelease records (cascades to tracks, release-artist links)
7. Delete Artist records
8. Clean up orphaned releases (no artist links)

**Critical edge case**: `--overwrite --only="bandA"` will also delete `bandB` if they share a release. This is intentional — shared releases must be fully rebuilt.

### Status Checking

#### `normalize_title(title: &str) -> String` (lines 2533–2542)
**Purpose**: Normalize release title for comparison. Same as `normalize_name` but without "the" stripping.
**Called by**: `check_release_status()`.

#### `check_release_status(pool, artist_id, mb_release_id, mb_release_title, mb_tracks) -> Result<(MatchStatus, Option<String>, f64), sqlx::Error>` (lines 2544–2642)
**Purpose**: Compare MB track list against local tracks to determine match status.
**Called by**: Sync phase release processing (lines 4452, 4534, 4265, 4161, 4864, 4901), re-match after merge.
**Algorithm**:
1. Fetch all local releases for this artist
2. Match by normalized title (exact match)
3. If no local match → `Missing`
4. Link local release to MB release (`LocalRelease.releaseId = mb_release_id`)
5. Compare track titles:
   - Exact normalized match, OR
   - Substring containment (local "September" matches MB "September (När hjärtat blöder)")
6. Classify:
   - No missing, no extra → `Complete` (score 1.0)
   - No missing, has extra → `ExtraTracks` (score 1.0)
   - Has missing → `Incomplete` (score = matched/total)
7. Returns `(status, reason_string, score)`

**Edge case / refactor note**: The `releaseId` UPDATE on line 2571 is a SIDE EFFECT — this function both checks status AND links the local release to the MB release. In the refactor, split this into two functions:
- `link_local_to_mb_release(pool, local_release_id, mb_release_id)` — pure mutation, updates `LocalRelease.releaseId`
- `check_release_status(pool, artist_id, mb_release_id, mb_release_title, mb_tracks)` — pure query, returns `(MatchStatus, reason, score)` without mutating anything
The caller (sync loop) calls `link` first, then `check`. This makes the data flow explicit and testable.

### Checkpoint / Resume

Both `dmp-index` and `dmp-sync` support `--resume` independently. They use separate checkpoint fields so one can resume without affecting the other.

#### Current monolith functions:

#### `save_sync_progress(pool, folder_name)` (lines 2655–2663)
Updates `Statistics.lastSyncedArtist`. Called after each folder completes. **Note**: despite the column name, the monolith stores a **folder name** here (not an artist name) because it checkpoints per-folder. In the refactored split, `dmp-index` uses the new `lastIndexedFolder` column instead, and `dmp-sync` repurposes `lastSyncedArtist` for its actual intended meaning (last completed artist name).

#### `save_sync_args(pool, from, to, only)` (lines 2667–2676)
Persists filter args as JSON to `Statistics.lastSyncArgs`. Called at start of non-resume runs.

#### `load_sync_progress(pool) -> Result<(Option<String>, Option<SavedSyncArgs>), sqlx::Error>` (lines 2678–2693)
Loads both `lastSyncedArtist` and `lastSyncArgs` from Statistics.

#### `clear_sync_progress(pool)` (lines 2695–2702)
Clears both fields. Called on successful completion and at start of non-resume `--overwrite` runs.

#### Refactored checkpoint design:

**`dmp-index`**: Checkpoint = last completed folder name. Stored in `Statistics.lastIndexedFolder` (new field). After each folder completes all DB operations successfully, checkpoint is saved. On `--resume`, folders are iterated alphabetically and all folders `<= checkpoint` are skipped. On successful completion of all folders, checkpoint is cleared.

**`dmp-sync`**: Checkpoint = last completed artist name. Stored in `Statistics.lastSyncedArtist` (existing field). After each artist completes all API + DB operations successfully, checkpoint is saved. On `--resume`, artists are iterated alphabetically and all artists `<= checkpoint` are skipped. Filter args (`--from`/`--to`/`--only`) are saved alongside the checkpoint so a resumed run uses the same filters.

### Post-Processing

#### `update_release_totals_for_artist(pool, artist_id) -> Result<u64, sqlx::Error>` (lines 2708–2729)
Updates `LocalRelease.totalDuration` and `totalFileSize` by summing tracks.

#### `update_artist_totals_for_artist(pool, artist_id) -> Result<u64, sqlx::Error>` (lines 2731–2753)
Updates `Artist.totalTracks` and `totalFileSize` by summing across all linked releases.

### Artist Image Download

#### `download_artist_image(client, artist, artist_name, artist_slug, img_dir, artist_folder, s3_client, config, pool, artist_id, use_folder_img) -> Option<(&'static str, String)>` (lines 2759–2903)
**Purpose**: Multi-source artist image resolution. Returns `(source_name, local_path)`.
**Called by**: Sync phase (line 4371), extra artist sync (line 4813).
**Resolution order**:
1. **Folder image** (only if `use_folder_img=true`, which means single-artist folder)
2. **MB image relation** (URL from relations, Wikimedia Commons URLs auto-converted)
3. **Fanart.tv** (if FANART_API_KEY configured)
4. **Wikidata P18** (via wikidata relation URL)
5. **Wikipedia page image** (via wikipedia relation URL)
6. **Folder image fallback** (only if artist name matches folder name case-insensitively)

**After finding image**:
- Upload to S3 (if S3 configured) → update `Artist.imageUrl`
- Save locally → update `Artist.image`
- If S3-only mode, delete local temp file

### External Image APIs

#### `commons_page_to_file_url(url: &str) -> String` (lines 2909–2916)
Convert Wikimedia Commons page URL to direct file URL with `?width=500`.

#### `get_wikidata_image(client, wikidata_url) -> Option<String>` (lines 2919–2951)
Fetch P18 image claim from Wikidata entity. Parses entity ID from URL, queries Wikidata API.

#### `get_wikipedia_image(client, wiki_url) -> Option<String>` (lines 2954–2981)
Fetch page thumbnail from Wikipedia API (500px). Parses title from URL.

#### `get_fanart_image(client, mb_id, api_key) -> Option<String>` (lines 2984–3007)
Fetch artist image from Fanart.tv. Priority: `artistthumb` > `artistbackground`.

#### `download_and_resize(client, url, out_path) -> bool` (lines 3009–3040)
Download image from URL, resize to 200×200, save as JPEG. Generic utility.

### Statistics

#### `update_statistics(pool)` (lines 3046–3105)
**Purpose**: Upsert comprehensive library statistics into `Statistics` table.
**Called by**: Finalization (line 5175).
**Computed fields**: artists, mainArtists, relatedArtists, tracks, releases, genres, releasesWithCoverArt, playtime, plays, artistsSyncedWithMusicbrainz, releasesSyncedWithMusicbrainz, artistsWithCoverArt, lastScanEndedAt.
**Main vs Related distinction**: mainArtists have at least one TrackArtist row. relatedArtists have LocalReleaseArtist but no TrackArtist rows.

---

## The Main Loop: Per-Folder Processing

Lines 3381–5135. This is the heart of the script. Each iteration processes one artist folder.

### INDEX PHASE (lines 3393–3954)

#### Step 1: Load existing tracks + walk files (lines 3396–3438)
- Query existing tracks for this folder (`WHERE filePath LIKE 'folder/%'`) → `HashMap<filePath, (fileSize, mtime, contentHash)>`
- Skip if `--overwrite` (empty map = process everything)
- Walk folder recursively (follow symlinks) for audio files (mp3, m4a, opus, aac, ogg, flac)

#### Step 2: Extract metadata in parallel (lines 3441–3483)
- `par_iter()` with `extract_metadata()`
- Skip files with no artist tag (log to errors.log)
- Collect `Vec<TrackMeta>`

#### Step 3: Change detection + DB upsert (lines 3485–3765)

Per-track processing (lines 3523–3701):
1. **Change detection** (lines 3524–3549):
   - Same fileSize AND mtime (within 2 seconds) → skip
   - Same contentHash → update mtime only, skip
   - Changed or new → process
2. **Split artist tags**: `split_artists(albumArtist)` and `split_artists(artist)`
3. **Resolve folder path**: strip disc subfolder
4. **MB ID propagation** (lines 3508–3521): pre-scan builds map of `(album,year,albumArtist) → mb_album_id` so tracks without embedded IDs inherit from siblings
5. **Build groupKey**: `build_group_key()` with effective MB ID
6. **Ensure release**: `ensure_local_release_cached()`
7. **Artist linking** (lines 3612–3668):
   - Album artist tags → split → `ensure_artist_cached()` → add to `pending_release_artist_links` (Set) + `pending_links` (Vec with role)
   - If no album artists, fallback to first track artist
   - Track artist tags → split → `ensure_artist_cached()` → add to `pending_links` as PRIMARY
   - If no track artists, fallback to first album artist
   - Featured artists (from both tags, deduplicated) → FEATURED role
8. **Cover art hints**: if track has embedded picture, record for later extraction
9. **MB hint collection**: map artist DB ID → (mb_album_artist_id, mb_album_id) for sync phase
10. **Add to batch**: `batch_tracks.push((track, release_id))`

Post-track batch operations (lines 3703–3771):
- Batch mtime updates for hash-matched tracks
- `batch_upsert_tracks()` → returns `filePath → trackId` map
- Resolve pending TrackArtist links (filePath → trackId) → `batch_ensure_track_artists()`
- `batch_ensure_local_release_artists()` from pending set

#### Step 4: Cover art extraction (lines 3773–3840)
- `par_iter()` over releases needing art → `extract_cover_art()`
- Upload to S3 if configured (concurrent, max 8 in-flight)
- Update `LocalRelease.image` for local storage

#### Step 4b: Folder image fallback (lines 3842–3908)
- Find releases still without art
- Try `use_folder_image()` for each
- Upload to S3 + update DB

#### Backfill skipped context (lines 3910–3948)
- When tracks are skipped (unchanged), the index loop doesn't run for them → artist/release collections are incomplete
- Query DB for all releases in this folder by `folderPath LIKE 'folder/%'`
- Query all album-level artist IDs from LocalReleaseArtist for those releases
- This ensures the sync phase has the full picture even when most tracks were skipped

#### Step 5: Update totals (lines 3950–3954)
- `update_release_totals_for_artist()` + `update_artist_totals_for_artist()` for each artist ID

### SYNC PHASE (lines 3956–4636)

Per-artist sync loop (lines 3964–4636):

1. **Load artist info** from DB (name, slug, musicbrainzId)
2. **Skip** special artists ("Various Artists" etc.)
3. **Already synced check** (lines 3987–3993): if existing MB ID and not `--overwrite`, add to `synced_mb_ids` and fall through to re-match path
4. **Search MusicBrainz** (lines 4000–4070):
   - Call `find_mb_match_with_fallback()` with embedded MB hints
   - On compound name detection: queue all components as `pending_extra_artists`, delete compound artist's links, continue
   - On match: save `musicbrainzId` to Artist
   - On no match: update `lastSyncedAt`, continue
   - On error: log, increment `failed_sync`, continue
5. **Duplicate check** (lines 4072–4323): if this MB ID was already synced for a different artist:
   - Same artist: re-match local releases using existing DB data (no API calls)
   - Different artist: merge — move releases to primary, delete duplicate, re-match
   - Both paths batch-update match statuses on LocalRelease and MusicBrainzRelease
6. **Fetch artist details** (lines 4325–4380):
   - `mb_get_artist_detail()` → extract URLs, genres, tags
   - `batch_upsert_artist_urls()`, `batch_link_artist_genres()`
   - `download_artist_image()` (if not `--skip-images` in monolith / `--skip-artist-images` in refactored `dmp-sync`)
7. **Fetch release groups** (lines 4382–4398):
   - `mb_get_release_groups()` → all release groups (paginated)
8. **Process each release group** (lines 4406–4568):
   - Skip filtered types (`should_skip_release()`)
   - Check DB cache (`get_existing_mb_release_tracks()`) → skip API if tracks exist
   - `upsert_mb_release()` + `ensure_mb_release_artist_link()`
   - `mb_get_release_tracks()` → filter to Official releases
   - If empty (all non-official): delete the MB release record
   - `delete_mb_tracks_for_release()` + `batch_insert_mb_tracks()` (first release only)
   - `check_release_status()` → update both MB and local release statuses
9. **Compute average match score** (lines 4582–4616):
   - Average of all release scores → `Artist.averageMatchScore`
   - Update `lastSyncedAt`
   - Track as synced/partial/failed

### Compound TrackArtist resolution (lines 4638–4696)
- Find track-level artists that: have no MB ID, are NOT album-level artists for this folder's releases
- Use folder's album artist as anchor for `try_split_tag()`
- Queue discovered artists as `pending_extra_artists`

### Extra artist sync (lines 4700–4945)
- For each pending extra artist:
  1. Skip if already synced this run
  2. Check if already has MB ID (skip unless `--overwrite`)
  3. **Validate**: check if artist name appears in `albumArtist` tag (ILIKE substring) of any track in this folder's releases. If no matches → skip entirely (don't create the artist)
  4. `ensure_artist_cached()` + `batch_ensure_local_release_artists()`
  5. Save `musicbrainzId`
  6. Full sync: details, image, release groups, tracks, match status (identical to primary artist sync)

### Step 5b: Clean up empty artists (lines 4947–5013)
- Find artists in this folder with: no MB ID, `totalTracks = 0`
- Delete their TrackArtist links, LocalReleaseArtist links, then the Artist record
- Remove from `artist_cache` and `folder_artist_ids`

### Step 6: Cover Art Archive fallback (lines 5015–5121)
- Find releases still without art
- For each: look up MB release group ID, download from CAA
- **Legacy**: The monolith also writes `folder.jpg` to the source folder. In the split, CAA downloads are the **syncer's** responsibility (saves to `web/public/img/` and S3 only). The indexer handles local cover art from embedded pictures and existing `folder.jpg`/`cover.jpg` files.

### Cleanup & save (lines 5123–5134)
- S3-only mode: delete local temp files
- `save_sync_progress()` for this folder

---

## Data Flow & Dependencies

### Index Phase produces → Sync Phase consumes

| Data | Produced at | Consumed at |
|------|------------|-------------|
| `folder_artist_ids: HashSet<String>` | Index per-track + backfill | Sync loop iteration, compound resolution, empty artist cleanup |
| `folder_mb_hints: HashMap<String, (Option<String>, Option<String>)>` | Index per-track MB ID collection | Sync phase `find_mb_match_with_fallback()` hints |
| `folder_releases: HashMap<String, String>` | Index per-track + backfill | Compound resolution, CAA fallback, empty artist cleanup |
| `releases_with_art: HashSet<String>` | Cover art steps 4, 4b | CAA fallback step 6 |
| `releases_needing_art: HashMap<String, PathBuf>` | Index per-track | Cover art step 4 |

### Cross-Folder State

| Variable | Written by | Read by | Split impact |
|----------|-----------|---------|-------------|
| `artist_cache` | `ensure_artist_cached()` | Same, cleanup step | Both binaries need artist lookup; indexer writes, syncer reads |
| `release_cache` | `ensure_local_release_cached()` | Same | Indexer only |
| `synced_mb_ids` | Sync phase per-artist | Duplicate check, compound resolution, extra artist skip | Syncer only |
| `genre_cache` | `ensure_genre_cached()` | Same | Syncer only |
| `release_type_cache` | `ensure_release_type_cached()` | Same | Syncer only |
| `limiter` | All `mb_*` calls | Same | Syncer only |

---

## Shared State Across Iterations

These variables maintain state across folder iterations and would need careful handling in a split:

1. **`synced_mb_ids`** — prevents re-syncing the same MB artist across different folders. Essential for performance (avoids redundant API calls) and correctness (duplicate detection). In a split binary, the syncer would need to check `Artist.musicbrainzId IS NOT NULL AND lastSyncedAt > run_start_time`.

2. **`artist_cache`** / **`release_cache`** — pre-loaded from DB at startup, updated during processing. In a split, the indexer pre-loads and maintains these. The syncer can just query DB directly (it's not performance-critical for syncer since it makes API calls).

3. **`failed_artists`** / **`artists_with_errors`** — summary data. Each binary tracks its own.

---

## Split Boundary Analysis

### Rust Project Structure

Cargo workspace with a shared library crate:

```
scripts/
  Cargo.toml              # [workspace] members
  dmp-common/             # shared library crate
    Cargo.toml
    src/lib.rs
  dmp-index/              # binary crate
    Cargo.toml
    src/main.rs
  dmp-sync/               # binary crate
    Cargo.toml
    src/main.rs
  dmp-fix/                # binary crate (future)
    Cargo.toml
    src/main.rs
```

`dmp-common` contains all shared code (config, slug, filters, artist helpers, S3, DB utils). Each binary depends on `dmp-common` via path dependency.

### Implementation Order

1. **`dmp-common`** — shared crate with config, types, DB helpers, S3, filters
2. **`dmp-index`** — the foundation; syncer depends on indexed data
3. **`dmp-sync`** — builds on top of indexed data in DB
4. **`dmp-fix`** — lowest priority, only needed when tags are broken

### Proposed split: `dmp-index` (local) + `dmp-sync` (external API)

#### `dmp-index` would contain:
- `IndexArgs` (see CLI spec above)
- `TrackMeta`, `Config` (subset: no fanart_api_key needed)
- `load_config()`, `sanitize_tag()`, `extract_metadata()`
- `normalize_filter()`, `matches_filter()`, `strip_disc_subfolder()`, `build_group_key()`, `make_slug()`
- `split_artists()`, `is_various_artists()`, `is_special_artist_name()` (+ helpers)
- `extract_cover_art()`, `use_folder_image()`, `use_artist_folder_image()`
- `ensure_artist()`, `ensure_artist_cached()`, `ensure_local_release()`, `ensure_local_release_cached()`
- `batch_upsert_tracks()`, `batch_ensure_track_artists()`, `batch_ensure_local_release_artists()`
- `nuke_artists()` (local portion — DB deletes + local image deletes)
- `save_sync_progress()`, `save_sync_args()`, `load_sync_progress()`, `clear_sync_progress()`
- `update_release_totals_for_artist()`, `update_artist_totals_for_artist()`
- S3 operations (for cover art upload)
- `update_statistics()` (index-relevant counters only: artists, tracks, releases, file sizes)
- The INDEX PHASE of the main loop
- Cover art steps 4, 4b
- Backfill step
- Step 5 (update totals)

**Execution model**: Truly sequential folder iteration. Enter folder → process → commit → next. Per-folder transactions ensure atomicity. See [Quick Scan Detail](#quick-scan-detail---quick) for the full loop with mtime pre-filter, parallel jwalk + rayon within each folder, deletion reconciliation, and SIGTERM handling.

#### `dmp-sync` would contain:
- `SyncArgs` (see CLI spec above — includes `--skip-artist-images` and `--skip-release-images` as separate flags)
- `Config` (subset: no MUSIC_DIR; needs DB, S3, Fanart.tv config)
- MB API types, `RateLimiter`, `mb_get()`, all `mb_*` functions
- `normalize_name()`, `names_are_similar()`, `is_likely_compound_of()`
- `find_mb_match_with_fallback()`, `try_release_group_credits()`, `try_split_tag()`
- `mb_search_artist()`, `mb_lookup_artist()`, `mb_lookup_release_group_artist()`
- `mb_search_release_group_credits()`, `mb_get_artist_detail()`, `mb_get_release_groups()`, `mb_get_release_tracks()`
- `should_skip_release()`
- `MatchStatus`, `normalize_title()`, `check_release_status()`
- `ensure_release_type()`, `ensure_genre()`, `upsert_mb_release()`, `ensure_mb_release_artist_link()`
- `batch_insert_mb_tracks()`, `delete_mb_tracks_for_release()`, `get_existing_mb_release_tracks()`
- `batch_link_artist_genres()`, `batch_upsert_artist_urls()`
- `download_artist_image()`, all image API helpers (Fanart.tv, Wikidata, Wikipedia, CAA)
- `download_release_cover_art()` — downloads from CAA, saves to `web/public/img/releases/` and S3 only (NO `folder.jpg` write to MUSIC_DIR)
- S3 operations (for artist/cover image upload)
- The SYNC PHASE of the main loop
- Compound TrackArtist resolution
- Extra artist sync
- Empty artist cleanup
- `update_statistics()` (full version)
- **NOT included**: anything that touches MUSIC_DIR or the filesystem. Zero filesystem dependency.

#### Shared code (extract to `dmp-common` crate):
- `Config`, `load_config()`
- `make_slug()`
- `normalize_filter()`, `matches_filter()`
- `is_various_artists()`, `is_special_artist_name()`, `is_special_mb_artist()`, `SPECIAL_MB_ARTIST_IDS`
- `ensure_artist()`, `ensure_artist_cached()` (both need to create artists)
- S3 operations
- `save_sync_progress()`, `load_sync_progress()`, `clear_sync_progress()`
- `update_release_totals_for_artist()`, `update_artist_totals_for_artist()`
- `update_statistics()`

#### Data handoff: Index → Sync

The syncer is **entirely DB-driven** — it has no access to MUSIC_DIR and does not read the filesystem. The DB is the sole communication channel.

**Automatic sync targeting via timestamps**:

The indexer sets `Artist.lastIndexedAt = NOW()` for **ALL artists linked to any release it processes** — not just the artists found via tag splitting in the current folder. This is done via a single query after batch operations:

```sql
UPDATE "Artist" SET "lastIndexedAt" = NOW()
WHERE id IN (
  SELECT DISTINCT la."artistId" FROM "LocalReleaseArtist" la
  WHERE la."localReleaseId" IN (:processed_release_ids)
)
```

This ensures collaborator artists (e.g. a featured artist discovered during a previous sync and linked to a release via `LocalReleaseArtist`) get their `lastIndexedAt` bumped when the release they contribute to is re-indexed. Without this, collaborators would never trigger a re-sync even when their release data changes.

The syncer's default behavior (no `--from`/`--to`/`--only`) queries only artists that need syncing:

```sql
SELECT id, name, slug, "musicbrainzId"
FROM "Artist"
WHERE "lastIndexedAt" > "lastSyncedAt"   -- changed since last sync
   OR "lastSyncedAt" IS NULL             -- never synced
ORDER BY name ASC
```

When explicit filters are provided (`--from`, `--to`, `--only`), the timestamp filter is bypassed and the artist name filter is used instead:

```sql
SELECT id, name, slug, "musicbrainzId"
FROM "Artist"
WHERE name >= :from AND name < :to   -- or ILIKE for --only
ORDER BY name ASC
```

When `--only` is used with multiple artists (`;`-separated), each is matched independently.

After successfully syncing an artist, the syncer sets `Artist.lastSyncedAt = NOW()`.

**DB fields used**:
- `Artist.lastIndexedAt: DateTime?` — **new**, set by indexer for ALL artists linked to any release processed in the current run (via `LocalReleaseArtist`)
- `Artist.lastSyncedAt: DateTime?` — **already exists**, set by syncer after successful sync of this artist

**Typical workflow**:
1. User adds 3 albums → `dmp-index --quick` (touches 2 artists, sets their `lastIndexedAt`)
2. `dmp-sync` (no flags) → queries `WHERE lastIndexedAt > lastSyncedAt` → syncs only those 2 artists
3. No manual `--only` needed

**MB hints**: Embedded MB IDs that the indexer extracted from file tags are stored in dedicated columns on `LocalReleaseTrack`: `mbAlbumId` and `mbAlbumArtistId` (see DB Schema Changes). The syncer reads these from the DB:
```sql
SELECT DISTINCT t."mbAlbumId", t."mbAlbumArtistId"
FROM "LocalReleaseTrack" t
JOIN "LocalRelease" r ON t."localReleaseId" = r.id
JOIN "LocalReleaseArtist" la ON la."localReleaseId" = r.id
WHERE la."artistId" = :artist_id
  AND t."mbAlbumId" IS NOT NULL
```

**No file-based handoff or shared process state needed.**

#### Critical coupling points:
1. **`folder_mb_hints`** — embedded MB IDs extracted during indexing, persisted to `LocalReleaseTrack.mbAlbumId` / `mbAlbumArtistId` columns (new — see DB Schema Changes). The syncer reads these from the DB (see query above). No direct handoff needed.
2. **`pending_extra_artists`** — compound name resolution happens mid-sync and discovers new artists that need both indexing (create Artist, link releases) and syncing (MB details, catalogue). In a split, the syncer creates minimal Artist records via `ensure_artist_cached()` with `lastIndexedAt = NULL`. These artists will be fully indexed on the next `dmp-index` run (the indexer picks them up because they're linked to releases via `LocalReleaseArtist`). The syncer proceeds to sync them immediately (MB details, images, catalogue) without waiting for the indexer.
3. **Cover Art Archive** — the syncer downloads CAA images and saves them to `web/public/img/releases/` and S3. It does NOT write `folder.jpg` to MUSIC_DIR (syncer has no filesystem access). Controlled by `--skip-release-images`.
4. **Artist images** — downloaded from Fanart.tv / Wikidata / Wikipedia after MB artist detail is fetched. Saved to `web/public/img/artists/` and S3. Controlled by `--skip-artist-images`. No MUSIC_DIR access.
5. **Nuke / `--overwrite`** — deletes both local data (indexer concern) and MB data. Each binary handles its own scope:
   - `dmp-index --overwrite`: nukes local releases, tracks, track artists, local release artists, local images for matched folders
   - `dmp-sync --overwrite`: nukes MB releases, MB tracks, MB release artists, genres, URLs, artist images for matched artists
6. **`lastIndexedAt` → `lastSyncedAt` handoff** — the indexer updates `Artist.lastIndexedAt` for ALL artists linked (via `LocalReleaseArtist`) to any release it processes, including collaborators. The syncer's default query filters to `WHERE lastIndexedAt > lastSyncedAt OR lastSyncedAt IS NULL`, so only changed artists are synced. Explicit `--only`/`--from`/`--to` overrides this filter.

---

## Run Lock (Concurrent Execution Prevention)

Plex uses a single-threaded scan queue — only one scan runs at a time. We follow the same model using a DB-based lock.

### Lock Table

```sql
CREATE TABLE "ScanLock" (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  lockedBy   TEXT,           -- 'index' | 'sync' | NULL
  lockedAt   TIMESTAMP,
  pid        INTEGER,
  args       TEXT            -- JSON of CLI args for display in UI
);
```

Single-row table (enforced by `id = 'singleton'`).

### Lock Protocol

**Acquire** (at startup, before any work):
```sql
UPDATE "ScanLock"
SET "lockedBy" = :binary_name, "lockedAt" = NOW(), pid = :pid, args = :args_json
WHERE "lockedBy" IS NULL
RETURNING id
```
If no row returned → another process holds the lock. Print which process and exit with a clear error.

**Release** (on completion or clean shutdown):
```sql
UPDATE "ScanLock"
SET "lockedBy" = NULL, "lockedAt" = NULL, pid = NULL, args = NULL
WHERE id = 'singleton'
```

**Stale lock detection**: If `lockedAt` is more than 6 hours ago, or the PID is dead (check via `kill(pid, 0)` or `/proc/pid/`), force-release the lock and re-acquire. Log a warning.

### Web UI Integration

The web UI checks the lock before triggering a scan:
1. Query `ScanLock` → if locked, show "Scan in progress: {lockedBy} (running for {elapsed})" with a cancel button
2. If unlocked, show "Scan Library" button
3. Cancel = send SIGTERM to the PID (the binary should handle SIGTERM gracefully: finish current folder, save checkpoint, release lock)

### Interaction Between Index and Sync

The lock is shared — you cannot run `dmp-index` and `dmp-sync` concurrently. This is intentional:
- Running sync while index is modifying artist/release records would cause inconsistent reads
- The typical workflow is sequential: `dmp-index --quick && dmp-sync`
- The web UI should offer a "Full Refresh" button that chains both commands

### Structured Progress Output

Both binaries emit structured progress lines to stdout alongside their normal output. The web UI's terminal SSE stream can parse these for progress display:

```
PROGRESS:{"phase":"index","folder":"Radiohead","current":1234,"total":5678,"new":3,"updated":1,"skipped":412,"deleted":0}
PROGRESS:{"phase":"sync","artist":"Radiohead","current":42,"total":150,"status":"fetching_releases"}
```

Format: `PROGRESS:` prefix followed by a JSON object. The web UI component can detect this prefix, parse the JSON, and render a structured progress bar instead of raw text. Non-PROGRESS lines are displayed as normal terminal output.

Fields:
- `phase`: `"index"` or `"sync"`
- `current` / `total`: folder or artist count for progress percentage
- `folder` or `artist`: name of the item being processed
- Index-specific: `new`, `updated`, `skipped`, `deleted` counts per folder
- Sync-specific: `status` (`"searching_mb"`, `"fetching_releases"`, `"downloading_image"`, etc.)

---

## Deletion Reconciliation & Cascading Cleanup

When files disappear from disk (deleted, moved, or renamed), the indexer must remove all associated DB records **leaving no loose ends**. This is critical — the current monolith does not handle deletions at all.

### Detection

During per-folder processing (both quick and full scan), deleted files are detected by comparing jwalk results against `LocalReleaseTrack` rows for that folder. Any DB path not found in the current walk is a deleted file. See also [Entire Folder Deletion](#entire-folder-deletion) for detecting folders removed from disk entirely.

### Cascading Delete Algorithm

When tracks are deleted, the cleanup cascades through the entire data model:

```
delete_tracks(deleted_file_paths):
    1. Delete TrackArtist rows for these tracks
    2. Delete LocalReleaseTrack rows for these tracks
    3. Find releases that now have ZERO tracks → delete_empty_releases()
    4. Find artists that now have ZERO local data → delete_orphan_artists()

delete_empty_releases(release_ids):
    1. Delete LocalReleaseArtist rows for these releases
    2. Delete release images (local + S3)
    3. Unlink from MB: SET LocalRelease.releaseId = NULL (but don't delete the MB release yet)
    4. Delete LocalRelease rows

delete_orphan_artists(artist_ids):
    For each artist with no remaining LocalReleaseArtist links:
        1. Check if this artist was ONLY connected because of the deleted content:
           - Has no LocalReleaseArtist links to ANY release with tracks → orphan
        2. Delete all MB data for this artist:
           - MusicBrainzReleaseArtist links
           - MusicBrainzReleaseTrack rows (for MB releases linked ONLY to this artist)
           - MusicBrainzRelease rows (for MB releases linked ONLY to this artist)
           - Artist genres (_ArtistGenres junction)
           - ArtistUrl rows
        3. Delete artist image (local + S3)
        4. Delete TrackArtist rows (any remaining)
        5. Delete Artist row
        6. Remove from artist_cache

    For MB releases linked to MULTIPLE artists:
        - Only delete the MusicBrainzReleaseArtist link for the deleted artist
        - Keep the MusicBrainzRelease and its tracks (other artists still reference them)
```

### "Leave No Loose Ends" Invariant

After deletion reconciliation, these must ALL hold true:
- Every `LocalReleaseTrack` references a file that exists on disk
- Every `LocalRelease` has at least one `LocalReleaseTrack`
- Every `Artist` has at least one `LocalReleaseArtist` link to a release with tracks
- Every `TrackArtist` references an existing track AND an existing artist
- Every `MusicBrainzReleaseArtist` references an existing `Artist`
- Every `MusicBrainzRelease` has at least one `MusicBrainzReleaseArtist`
- No orphan images exist in `web/public/img/` or S3 without a corresponding DB record

### Related Artist Cascade

If artist B was added to the DB solely because it contributed to a release of artist A (e.g. a featured artist discovered during sync), and artist A is deleted, artist B must also be completely deleted — including all MB tables. The test: after removing artist A's data, does artist B have ANY remaining `LocalReleaseArtist` links to releases with tracks? If not → full cascade delete of artist B.

### Entire Folder Deletion

Per-folder deletion reconciliation only runs for folders the loop enters. If a folder is completely removed from disk, `readdir(MUSIC_DIR)` simply doesn't return it — the loop never enters it, and stale `LocalReleaseTrack` rows persist. Both quick and full scan must run a post-loop cleanup:

```
db_folders = SELECT DISTINCT substring("filePath" from '^[^/]+') FROM "LocalReleaseTrack"
disk_folders = readdir(MUSIC_DIR)
for db_folder in db_folders:
    if db_folder not in disk_folders:
        // folder gone — cascade delete all its tracks, releases, and orphan artists
        cascade_delete_folder(db_folder)
        DELETE FROM FolderScan WHERE folderPath = db_folder
```

This reuses the same cascading delete algorithm as per-folder deletion. The query groups by the top-level folder prefix of `filePath` to match the `readdir` granularity.

### Folder Rename Detection

When a folder is renamed (e.g. `Bjork/` → `Björk/`):
- Quick scan sees: new folder `Björk/` (process it) + old folder `Bjork/` gone from disk (post-loop entire-folder deletion cascade)
- This creates a new artist `Björk` and deletes the old `Bjork` artist — effectively a clean re-index
- If both names produce the same slug, the new artist reuses the existing DB record (upsert on slug)
- If different slugs: two separate artists exist briefly, then the old one is cleaned up

---

## Edge Cases & Gotchas

### Name/Slug Collisions
- `make_slug("!!!")` → `"artist-{md5}"` (fallback for names with no alphanumeric chars)
- Two artists with same slug → same DB record (upsert on slug). This is intentional for name variants.
- `nuke_artists()` matches by NAME not slug (line 2362) because slugify strips characters that distinguish artists (e.g. "...And Oceans" vs "And Oceans")

### MB ID Propagation
- Pre-scan (lines 3508–3521): if some tracks in a folder have `mb_album_id` and others share the same `(album, year, albumArtist)`, the MB ID propagates to siblings. This ensures they get the same `groupKey` and are grouped into one release.

### Content Hash Change Detection
- Hash is metadata-based (not audio content): `artist|albumArtist|album|title|year|track|disc|genre`
- If tags are re-written but audio is unchanged, hash changes → track is re-upserted
- If only mtime changed but nothing else, only mtime is updated (line 3535)
- Two-second tolerance on mtime comparison (line 3528) — filesystem precision varies

### Multi-Disc Releases
- `strip_disc_subfolder()` normalizes `Artist/Album/CD1` and `Artist/Album/CD2` to `Artist/Album`
- Combined with `build_group_key()`, all discs get the same `groupKey` → single LocalRelease record
- If tracks have different `mb_album_id` per disc (unusual but possible), the first one encountered wins via `mb_id_by_meta` map

### Compound Artist Resolution Order
1. At index time: `split_artists()` splits unambiguous separators (/, //, \\, |, ;, vs., feat.)
2. At sync time step 4-6: `find_mb_match_with_fallback()` tries MB credit resolution for remaining ambiguous separators (&, ,)
3. After sync: compound TrackArtist names are resolved via `try_split_tag()` with folder anchor
4. Extra artists are validated against `albumArtist` tag (ILIKE substring) before creation

### Image Resolution Conflicts
- Single-artist folder: folder image allowed for artist photo (handled by indexer)
- Multi-artist folder: folder image NOT used for artist photo (would give all artists same image)
- Exception: if artist name matches folder name case-insensitively, folder image IS used as last-resort fallback
- `--skip-artist-images` (syncer): skips all artist photo resolution (Fanart.tv, Wikidata, Wikipedia). Does NOT skip release cover art.
- `--skip-release-images` (syncer): skips CAA downloads. Does NOT skip embedded cover art extraction or `folder.jpg` fallback (those are handled by the indexer, which reads from MUSIC_DIR).
- Both flags are independent and can be combined.
- The syncer never writes to MUSIC_DIR. All downloaded images go to `web/public/img/` and S3.

### Re-sync Without API Calls
When an artist already has `musicbrainzId`:
- If same MB ID already synced this run (in `synced_mb_ids`):
  - Same artist: re-match local releases against existing MB tracks in DB
  - Different artist: merge duplicate → redirect releases → delete duplicate
- If not yet synced: mark in `synced_mb_ids`, fall through to check_release_status for existing MB releases in DB

### Error Recovery
- All errors are non-fatal (continue to next item)
- Errors logged to `errors.log` with timestamp + context
- Failed artists tracked in `failed_artists` Vec for summary
- Rate limit exhaustion on a release: breaks the release loop for that artist, marks as partial
- Resume restarts from the failed folder (not mid-folder)

### TrackArtist vs LocalReleaseArtist
- **TrackArtist**: per-track link, has a `role` (PRIMARY, ALBUM_ARTIST, FEATURED). Created during indexing from raw tags.
- **LocalReleaseArtist**: per-release link, no role. Created during indexing for album artists + during sync for extra artists.
- The distinction between "main artist" and "related artist" is based on whether TrackArtist rows exist (statistics query).

### Batch Operations
All batch DB operations use PostgreSQL's UNNEST pattern for performance:
- `batch_upsert_tracks()` — up to hundreds of tracks per folder
- `batch_ensure_track_artists()` — multiple links per track
- `batch_insert_mb_tracks()` — up to 20+ tracks per release
- `batch_ensure_local_release_artists()` — per-folder batch
- `batch_link_artist_genres()` — per-artist batch
- `batch_upsert_artist_urls()` — per-artist batch

### Module Extraction Candidates (for refactoring)

| Module | Functions | Lines | Dependencies |
|--------|-----------|-------|-------------|
| `config` | `Args`, `Config`, `load_config()` | ~100 | clap, dotenvy |
| `metadata` | `TrackMeta`, `extract_metadata()`, `sanitize_tag()` | ~200 | lofty, md5, serde_json |
| `filters` | `normalize_filter()`, `matches_filter()`, `strip_disc_subfolder()`, `build_group_key()`, `make_slug()` | ~100 | slug, md5 |
| `artists` | `split_artists()`, `is_*()`, `SPECIAL_MB_ARTIST_IDS` | ~130 | regex |
| `images_local` | `extract_cover_art()`, `use_folder_image()`, `use_artist_folder_image()` | ~100 | image, lofty |
| `images_remote` | `download_cover_art()`, `download_artist_image()`, `download_and_resize()`, `get_wikidata_image()`, `get_wikipedia_image()`, `get_fanart_image()`, `commons_page_to_file_url()` | ~200 | reqwest, image |
| `rate_limiter` | `RateLimiter` | ~70 | tokio |
| `mb_api` | `mb_get()`, `mb_search_artist()`, `mb_lookup_artist()`, `mb_lookup_release_group_artist()`, `mb_search_release_group_credits()`, `mb_get_artist_detail()`, `mb_get_release_groups()`, `mb_get_release_tracks()` | ~250 | reqwest, serde |
| `mb_types` | All MB API structs | ~100 | serde |
| `mb_matching` | `normalize_name()`, `names_are_similar()`, `is_likely_compound_of()`, `find_mb_match_with_fallback()`, `try_release_group_credits()`, `try_split_tag()` | ~350 | regex |
| `mb_filter` | `should_skip_release()` | ~20 | — |
| `db_index` | `ensure_artist*()`, `ensure_local_release*()`, `batch_upsert_tracks()`, `batch_ensure_track_artists()`, `batch_ensure_local_release_artists()` | ~250 | sqlx |
| `db_sync` | `ensure_release_type*()`, `ensure_genre*()`, `upsert_mb_release()`, `ensure_mb_release_artist_link()`, `batch_insert_mb_tracks()`, `delete_mb_tracks_for_release()`, `get_existing_mb_release_tracks()`, `batch_link_artist_genres()`, `batch_upsert_artist_urls()` | ~250 | sqlx |
| `status` | `MatchStatus`, `normalize_title()`, `check_release_status()` | ~130 | sqlx |
| `nuke` | `nuke_artists()` | ~170 | sqlx, S3 |
| `checkpoint` | `SavedSyncArgs`, `save_sync_progress()`, etc. | ~50 | sqlx |
| `totals` | `update_release_totals_for_artist()`, `update_artist_totals_for_artist()` | ~50 | sqlx |
| `statistics` | `update_statistics()` | ~60 | sqlx |
| `s3` | `create_s3_client()`, `upload_to_s3()`, `delete_from_s3()`, `upload_release_image_to_s3()` | ~80 | aws-sdk-s3 |

**Total: ~17 modules, covering ~2700 lines of functions (the remaining ~2500 lines are the main loop orchestration).**

---

## DB Schema Changes Required

The refactored binaries require the following additions to `web/prisma/schema.prisma`:

### New field on `Artist`:
```prisma
model Artist {
  // ... existing fields ...
  lastIndexedAt  DateTime?   // Set by indexer for all artists linked to processed releases
  // lastSyncedAt already exists — no change needed, only behavior change (syncer sets it after successful sync)
}
```

### New fields on `LocalReleaseTrack`:
```prisma
model LocalReleaseTrack {
  // ... existing fields ...
  mbAlbumId        String?   // MUSICBRAINZ_ALBUMID / MUSICBRAINZ_RELEASEGROUPID from file tags
  mbAlbumArtistId  String?   // MUSICBRAINZ_ALBUMARTISTID from file tags
}
```
Written by the indexer during `batch_upsert_tracks()`. Read by the syncer to get MB hints for artist matching (replaces the in-memory `folder_mb_hints` from the monolith). Currently these values live only in `TrackMeta` at runtime — persisting them enables the DB-driven handoff.

### New fields on `Statistics`:
```prisma
model Statistics {
  // ... existing fields ...
  lastIndexedFolder  String?   // Checkpoint for dmp-index --resume
}
```

### New table: `ScanLock`
```prisma
model ScanLock {
  id        String    @id @default("singleton")
  lockedBy  String?   // "index" | "sync" | null
  lockedAt  DateTime?
  pid       Int?
  args      String?   // JSON of CLI args for UI display
}
```

### New table: `FolderScan`
```prisma
model FolderScan {
  folderPath  String    @id       // top-level folder name (e.g. "Radiohead")
  mtime       DateTime            // last known directory mtime
}
```
Used by `--quick` scan to skip unchanged folders. One row per top-level artist folder.

### No `FileManifest` table needed
`LocalReleaseTrack` already stores `filePath`, `fileSize`, and `mtime` — it serves as the file manifest. Deletion reconciliation queries `LocalReleaseTrack` by folder prefix.

---

## Hard Constraint: Read-Only Filesystem

**Neither the indexer nor the syncer may modify audio file metadata (tags).** No rewriting ID3 frames, no fixing encoding, no splitting albumArtist values in the files — nothing. Audio files are read-only input.

Writing non-metadata files (e.g. `folder.jpg` for cover art) into the music directory is acceptable.

All tag modification operations belong in a separate `dmp-fix` script (see `docs/scripts/metadata_fix.md`).

---

## Lessons from Helper Scripts (Patterns for the Refactor)

The following general issues were discovered through a series of workaround Python scripts (`fix_artist_names.py`, `fix_duplicates.py`, `fix_incomplete_metadata.py`, `fix_sync_errors.py`, `fix_unsplit_multiartist.py`, `fix_compound_tpe2.py`, `check_ampersand_artists.py`, `missing_metadata_report.py`). These scripts are being retired, but their lessons must be absorbed into the refactored index/sync. Grouped by which binary should handle them:

### Indexer: Corrupted Tag Detection & Fallback

**Problem**: TPE2 (albumArtist) frequently contains garbage — track numbers (`"01"`, `"02"`), years (`"2007"`), filesystem paths (`"Carlos Franzetti\\1977 - Grafitti"`), bitrate markers (`"@128"`), or the literal string `"lbumArtist/"` (broken field name leaked into value).

**Detection patterns** (regex):
- `^\d{1,3}$` — bare track number
- `^\d{1,3}\s*-\s*\w` — track number prefix (`"01 - Song Name"`)
- `^\d{4}\s*-\s*.+\s+-\s+.+\s+-\s+` — full path-like string
- `@\d{2,3}$` — bitrate suffix
- `albumArtist == year` — year leaked into TPE2

**What the indexer should do**: When albumArtist fails these checks, apply a fallback resolution chain using ONLY other metadata tags (DB-side, no file modification, no folder names):
1. Majority vote: most common non-garbage albumArtist across other tracks in the same release (grouped by `groupKey`)
2. Linked artists: artists already linked to the release with highest TrackArtist count
3. Track artist tag: use the `artist` (TPE1) tag from the same track
4. TXXX:ARTISTS or TXXX:ALBUMARTIST tags from the same file
5. If all fallbacks fail: skip the track entirely and log an error (do NOT derive from folder name)

### Indexer: Missing Metadata Derivation from Folder/Filename

**Problem**: Some tracks have `NULL` title, artist, or album. The file tags are simply empty.

**What the indexer should do**: When a core tag is missing, try alternate metadata sources from the same file. **Never derive data from folder or file names** — folder structure is organizational, not authoritative.

- **Album**: try alternate tag keys (`TXXX:ALBUM`, `TOAL`, `©alb`). If all empty → leave NULL in DB.
- **Title**: try alternate tag keys. If all empty → leave NULL in DB. The track is still indexed (it has a file path), but metadata-dependent features won't work for it.
- **Year**: try `TDRC`, `TYER`, `TDRL`, `DATE`, `©day`. If all empty → leave NULL.
- **Artist**: fallback to albumArtist tag, then TXXX:ARTISTS, then TXXX:ALBUMARTIST. If all empty → skip the track entirely and log an error.

**Rationale**: Folder names are references, not data. A flat folder with 2M files should produce the exact same DB state as a perfectly organized folder tree. Metadata is the sole source of truth.

### Indexer: Known Single Artists (Separator Allowlist)

**Problem**: `split_artists()` must NOT split band names that contain separator characters. The current code doesn't split on `&` or `,`, but the sync phase's Step 6 (`try_split_tag`) will try `&` and `,` when an anchor is present — this can incorrectly split "Simon & Garfunkel".

**What should exist**: A comprehensive allowlist of known single-artist names containing separators, checked before any splitting attempt. Compiled from real library data:

```
AC/DC, GZA/Genius, Joy/Disaster, Mats/Morgan, +/-,
Simon & Garfunkel, Kool & the Gang, Belle & Sebastian,
Emerson Lake & Palmer, Earth Wind & Fire, Mumford & Sons,
Crosby Stills & Nash, Crosby Stills Nash & Young,
Nick Cave & the Bad Seeds, Hootie & the Blowfish,
[~130 more entries — see fix_artist_names.py KNOWN_SINGLE_ARTISTS]
```

This should be a static data file or const, NOT hard-coded inline. The list includes:
- **Bands with `/`**: AC/DC, GZA/Genius, Joy/Disaster, Mats/Morgan, D/A A/D, Maurizio Bianchi / M.B.
- **Bands with `&`**: All "X & the Y" patterns (backing bands), duo names (Simon & Garfunkel), multi-word group names (Angels & Airwaves, Maps & Atlases)
- **Bands with `,`**: "Last, First" names (Hank Williams, Jr.), multi-word band names (Black Country, New Road; Slaughter Beach, Dog; Nothing,Nowhere.)

### Indexer: Unsplit Multi-Artist Tags That Slipped Through

**Problem**: Albums are linked to a single artist in `LocalReleaseArtist`, but the `albumArtist` tag actually contains multiple artists separated by `feat.`, ` / `, or `;`. The index-time `split_artists()` should have caught these but didn't (edge cases in regex, or the tag was in a form not covered).

**Categories found in production**:
- `feat.` / `ft.` / `featuring` (including parenthesized forms like `"X (feat. Y)"`)
- ` / ` (space-slash-space — reliable multi-artist signal)
- `;` / `; ` (semicolon — reliable multi-artist signal)
- `\` (backslash — already the canonical separator, just needs resync)
- `,` (ambiguous — "Crosby, Stills & Nash" is one entity, "Yo-Yo Ma, Stuart Duncan, Edgar Meyer" is three)

**What the indexer should do**: Ensure `split_artists()` handles ALL of these patterns. The current implementation already handles most, but the fix scripts found edge cases:
- Parenthesized feat: `"X (feat. Y)"` — strip parens before splitting
- Comma splitting: only split on `,` when ALL resulting parts contain a space (avoids "Last, First" patterns and "10,000 Maniacs")
- `w/` as separator: `"X w/ Y"` should split (currently not handled)
- Recursive splitting: after splitting on one separator, each part should be checked for further separators (e.g. `"A & B feat. C"` → first split on feat → `"A & B"` + `"C"` → then split `"A & B"` on `&`)

### Syncer: Duplicate Artist Merging

**Problem**: Two Artist records exist with the same normalized name but different casing/spacing (e.g. `"FŒHN"` vs `"Fœhn Trio"`, or `"HävokÜnit"` vs `"Havoc Unit"`). The current sync detects this only when two names resolve to the same MB ID within one folder iteration.

**What the syncer should do**: At startup or as a post-processing step, query for duplicates using aggressive normalization (`LOWER(REPLACE(name, ' ', ''))`) and merge them:
- Skip pairs where BOTH have different MB IDs (confirmed different artists)
- Keep the record with more tracks as canonical
- Move all releases/links to canonical, delete the duplicate
- This is currently only triggered when two names collide within the same folder — cross-folder duplicates are missed

### Syncer: Orphan Cleanup (Built-In)

**Problem**: Various operations leave orphaned data: artists with no releases, releases with no tracks, MB releases with no artist links, phantom artists with numeric names and stale TrackArtist links.

**What the syncer should do**: Run cleanup as part of finalization (currently only `update_statistics()` runs at the end). Add:
1. Delete phantom artists: names matching `^\d{1,3}$` or `@\d{2,3}$` whose TrackArtist links point to tracks where `albumArtist != artist.name`
2. Delete orphan artists: no `LocalReleaseArtist` links to any release that has tracks
3. Delete orphan MB releases: no `MusicBrainzReleaseArtist` links
4. Delete empty local releases: no `LocalReleaseTrack` rows
5. Update statistics

### Indexer: File Corruption Resilience

**Problem**: `extract_metadata()` fails on files with invalid encoding, corrupt MPEG frames, invalid item sizes, or APE tag UTF-8 errors. These are logged to `errors.log` but otherwise lost.

**What the indexer should do**: The current lofty `ParsingMode::Relaxed` already helps, but the indexer should attempt harder recovery:
- If lofty fails, try reading just the ID3v2 header (skip APE)
- If encoding is invalid, attempt latin-1 → UTF-8 conversion of the tag values (read-only — derive corrected values without modifying the file)
- Always attempt to extract at least `artist` from: TXXX:ARTISTS, TXXX:ALBUM_ARTISTS, TPE2 (album artist) — even if the primary tag parse fails. Never fall back to folder name.

### Indexer: Additional Tag Sources

**Problem**: `fix_sync_errors.py` revealed that many files have artist information in non-standard locations that `extract_metadata()` doesn't check.

**Tag sources to check when `artist` is NULL** (in priority order):
1. `TXXX:ARTISTS` — multi-value artist field used by some taggers
2. `TXXX:ALBUM_ARTISTS` / `TXXX:ALBUMARTIST` — album artist variants
3. `TPE2` (albumArtist) — use as artist fallback
4. If ALL tag sources are empty → skip the track and log an error. Never derive artist from folder name.

### Syncer: Additional Compound Separator — Hyphen Between Full Names

**Problem**: `fix_compound_artists.py` revealed a common pattern in jazz/classical: hyphens used as artist separators when both sides are full names (e.g. `"Chick Corea-Herbie Hancock"`, `"Cecil Taylor-Bill Dixon-Tony Oxley"`, `"Stuff Smith-Dizzy Gillespie-Oscar Peterson"`). These are NOT band names (unlike `"Yo-Yo Ma"` where the hyphen is part of one name).

**What the syncer should do**: When `find_mb_match_with_fallback()` fails Steps 1–5, and the name contains `-` between what look like multi-word segments (each segment has >= 2 words or is a known artist), try splitting on `-` and searching each part. This is very low priority (Step 6 last resort) because hyphens in names are extremely common and ambiguous.

**Heuristic**: Only split on `-` when:
- There are 2+ segments after splitting
- Each segment contains at least 2 words (first + last name pattern)
- OR at least one segment is already a known MB artist (from `synced_mb_ids` or DB cache)
