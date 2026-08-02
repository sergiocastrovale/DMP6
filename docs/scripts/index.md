# Scripts: index

Walks MUSIC_DIR, extracts metadata from audio files, and upserts the local DB tree. Sets `lastIndexedAt` on artists only when data actually changes (new/updated/deleted tracks). Uses a run hash for resumability - interrupted runs continue from where they left off.

## Build

```bash
cd scripts && cargo build --release -p index
```

## Usage

```bash
./index                          # Index all artists
./index --only "radiohead"       # Only folders matching prefix
./index --only "radiohead;bjork" # Multiple artists (semicolon-separated)
./index --only "Air" --exact     # Exact match (won't catch "Airbag")
./index --from "A" --to "M"     # Letter range
./index --overwrite              # Force re-index (keeps existing covers)
./index --overwrite-with-images  # Force re-index + re-extract all covers
./index --inspect                # Re-check existing files for metadata changes
./index --resume                 # Continue from last checkpoint
./index --release "clxxxxxxx"   # Re-index a single release by LocalRelease ID
./index --folders "Artist/Album" # Re-index exact folder paths (semicolon-separated)
./index --skip-covers            # Skip cover art extraction
./index --threads 4              # Rayon thread count (default 8)
./index --delete                 # Delete local data for matched artists, then exit
./index --music-dir /path        # Override MUSIC_DIR env
./index --web                    # Emit PROGRESS:{json} for the web terminal
```

`--release` cannot combine with `--from`, `--to`, `--only`, or `--folders`.

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--from` / `-f` | String | - | Start letter filter |
| `--to` / `-t` | String | - | End letter filter |
| `--only` / `-o` | String | - | Semicolon-separated artist folder prefixes |
| `--exact` | bool | false | Exact match for `--only` (no prefix matching) |
| `--folders` | String | - | Exact relative folder paths to process |
| `--release` | String | - | Re-index single release by LocalRelease ID |
| `--overwrite` | bool | false | Re-index all tracks ignoring change detection (keeps existing covers) |
| `--overwrite-with-images` | bool | false | Like --overwrite but also deletes and re-extracts all cover art |
| `--inspect` | bool | false | Re-check existing files for metadata changes (size/mtime/hash) |
| `--skip-covers` | bool | false | Skip cover art extraction |
| `--resume` | bool | false | Resume from last checkpoint |
| `--delete` | bool | false | Nuke local data for matched artists, then exit |
| `--threads` | usize | 8 | Rayon thread count for parallel extraction |
| `--music-dir` | String | - | Override MUSIC_DIR from env |
| `--web` | bool | false | Emit PROGRESS:{json} for web terminal |
| `--emit-artist-ids` | String | - | Write processed artist IDs to file (one per line, used by refresh) |

## Output Modes

Without `--web`: colored, indented console progress. With `--web`: `PROGRESS:{json}` lines for the web UI progress bar, plus plain text for the terminal panel. The web UI appends `--web` automatically.

## Per-Folder Flow

1. **Walk** folder for audio files (mp3, flac, aac, opus, m4a, ogg) via jwalk
2. **Extract** metadata in parallel (rayon + lofty), including MB tags: `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_ALBUMARTISTID`
3. **Pre-scan** - propagate MB release/release-group IDs across tracks sharing same album/year/albumArtist
4. **Change detection** - default: skip if filePath exists in DB. `--inspect`: compare size/mtime/hash. `--overwrite`: skip change detection but preserve existing covers. `--overwrite-with-images`: skip everything and re-extract covers
5. **Split** albumArtist and artist tags into individual artists
6. **Upsert** Artist, LocalRelease, LocalReleaseTrack, LocalReleaseArtist, TrackRelatedArtist (batch UNNEST)
7. **Cover art** - extract from embedded tags or folder images, content-addressed by MD5 hash (same image bytes = one file, shared across releases)
8. **Delete** tracks no longer on disk
9. **Update totals** for this artist's releases and tracks
10. **Set `lastIndexedAt`** on Artist (only if new/updated/deleted tracks in folder)
11. **Stamp run hash** on FolderScan for resumability
12. **Upsert FolderScan** - stores folder mtime

Post-loop: detects entirely deleted folders (only when unfiltered), safety-net pass re-extracts missing release images.

## Locking & Resumability

Acquires a named DB lock (`"index"`). Clears stale locks older than 10 minutes. SIGTERM/Ctrl-C handlers release the lock on shutdown; second Ctrl-C force-exits. Checkpoint saved per-folder for `--resume`.

Run hash stored in `Settings.indexRunHash`. On restart, folders already processed (matching hash in `FolderScan`) are skipped entirely. Hash cleared on completion. `--overwrite` generates a new hash. Targeted ops (`--release`, `--folders`) bypass hash.

## Release Grouping

**One folder = one `LocalRelease`.** `build_group_key` (`scripts/index/src/db.rs`) keys a release on the containing folder alone: `"folder:{folderPath}"` (root-level files with no folder fall back to `"meta:{slugTitle}:{year}:{slugArtist}"`). The folder is treated as a *structural* boundary — its name is never parsed for metadata values; title/year/artist come only from tags, then from the MusicBrainz match.

Per-track MB ids (`mb_release_id` / `mb_release_group_id`) are **not** part of the group key. They identify which release a *recording* appears on, not which folder-album a *file* belongs to — keying on them shredded compilations (whose tracks carry their original sources' ids) into per-track fragments (see `docs/index_severe_bug.md`). The ids are still stored per-track for sync's matcher.

Display title/year for the release come from the folder's **majority (mode)** `album`/`year` tag (`folder_majority_title_year`), so a folder whose tracks disagree still gets a deterministic name (sync overrides it with the MB title once matched).

`folderPath` scoping means the same album ripped into two folders creates two separate `LocalRelease` rows — genuine duplicate copies. Sync binds both to the same `MusicBrainzRelease` via `releaseId`; the web UI collapses them into one card, and the `duplicate-release` audit rule surfaces them for review.

**Compilations link many artists to one release.** Index creates one `LocalReleaseArtist` link per distinct `albumArtist` tag in the folder (main artists), plus `TrackRelatedArtist` links for track-level guests. A comp tagged `albumArtist = "Various Artists"` gets one link; a per-source-tagged comp (each track credited to its original performer) gets N links to the *same* single `LocalRelease` — shared via the many-to-many table, not duplicated per artist, so it appears on each of those N artists' pages.

## Cover Art Deduplication

Cover images are content-addressed: the filename is the MD5 hash of the image file (`{hash}.jpg`). Multiple `LocalRelease` rows can share the same image - e.g. a 90-disc box set extracts one cover instead of 90.

Two levels of deduplication:
- **MB ID shortcut**: Releases sharing `mb_release_id` or `mb_release_group_id` with an already-processed release skip extraction entirely and reuse the known content hash
- **Content hash**: After extraction, if `{hash}.jpg` already exists on disk, the duplicate is discarded

Works with all storage modes (`local`, `s3`, `both`). S3 uploads happen once per unique hash. Shared images are reference-counted on delete - the file is only removed when no `LocalRelease` points to it.

## Artist Tag Splitting

`split_artists()` in `common/src/artists.rs`:
- Splits on `feat.`/`ft.`/`featuring` → featured artists
- Splits on `//` `\\` `||` `;` `|` - unambiguous separators
- Splits on ` / ` ` \ ` (space-surrounded only - preserves AC/DC)
- Splits on `vs.`/`vs`
- Does **not** split on `,` or `&` (preserves "10,000 Maniacs", "Simon & Garfunkel")

## Artist Roles (Main vs Related)

Derived entirely from file metadata:

- **Main artist** = in `albumArtist` tag → `Artist.relatedOnly = false`, linked via `LocalReleaseArtist`
- **Related artist** = in `artist` tag but NOT in `albumArtist` → `Artist.relatedOnly = true`, linked via `TrackRelatedArtist`

If a related artist later appears as albumArtist on another release, `relatedOnly` flips to `false`.

## Running on NAS

```bash
sudo docker exec dmp index --from=e --to=fz
```
