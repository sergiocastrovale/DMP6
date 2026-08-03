# Scripts: fix

Reads `PENDING` issue rows from the DB and applies the corresponding fix: tag writes for corrupted/missing issues, DB-only operations for orphans and duplicates.

Issues are detected by `./audit` and queued via the `/issues` web UI (or directly via `POST /api/issues/{type}/queue`).

## Usage

```bash
./fix --corrupted    # Fix corrupted albumArtist tags
./fix --orphans      # Delete orphan/phantom artists from DB
./fix --duplicates   # Merge duplicate artists (B into A)
./fix --missing      # Write proposed values for tracks with missing metadata
./fix --revert --corrupted   # Revert previously applied corrupted fixes
./fix --revert --missing     # Revert previously applied missing fixes
./fix --revert --mode undo-resolved --corrupted  # Revert but keep RESOLVED status
```

All fix types can be combined in one invocation. Only rows with `status = 'PENDING'` are processed. Exits with error if no type flag given.

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--corrupted` | bool | false | Fix corrupted TPE2 issues |
| `--orphans` | bool | false | Fix orphan artists (delete) |
| `--duplicates` | bool | false | Fix duplicate artists (merge B into A) |
| `--missing` | bool | false | Fix missing metadata (tag writes) |
| `--revert` | bool | false | Revert previously applied fixes instead of fixing |
| `--mode` | String | `"undo"` | Revert mode: `"undo"` (→DETECTED) or `"undo-resolved"` (stays RESOLVED) |

## Auto Re-index

After tag-writing fixes (corrupted, missing), fix automatically invokes the sibling `index` binary with `--folders <affected_folders> --skip-covers` to re-index changed files. Only triggers when file writes actually happened.

## Fix Logic Per Type

### `--corrupted`

Reads `IssueCorruptedTpe2` rows where `status = 'PENDING'`. For each:
1. Opens the audio file at `track.filePath` (resolved against `MUSIC_DIR`)
2. Writes `proposedValue` as the new `albumArtist` tag (TPE2/ALBUMARTIST/aART)
3. Bumps parent directory mtime (creates and deletes `.fix-touch`) so `./index --quick` detects the change
4. Marks issue as `RESOLVED` or `FAILED`

### `--orphans`

Reads `IssueOrphanArtist` rows where `status = 'PENDING'`. For each:
1. Deletes the artist's local image file (if set)
2. `DELETE FROM "Artist" WHERE id = $artistId` - cascades to ArtistUrl, junction tables, TrackRelatedArtist

No file tag changes. Cannot be reverted.

### `--duplicates`

Reads `IssueDuplicateArtist` rows where `status = 'PENDING'`. For each pair (A = keep, B = merge):
1. Re-points `LocalReleaseArtist`, `TrackRelatedArtist`, `MusicBrainzReleaseArtist` rows from B to A (skipping conflicts)
2. Deletes remaining B junction rows
3. Deletes B's local image file
4. `DELETE FROM "Artist" WHERE id = $artistBId`

Artist A's image, MusicBrainz ID, and stats are preserved. Cannot be reverted.

### `--missing`

Reads `IssueMissingMetadata` rows where `status = 'PENDING'` and `proposedValues IS NOT NULL`. For each:
1. Opens the audio file
2. Writes any proposed fields (`albumArtist`, `artist`, `album`, `year`)
3. Bumps directory mtime
4. Marks `RESOLVED` or `FAILED`

Rows where `proposedValues` is null (title/album with no derivable value) are skipped.

## Revert

`--revert` restores original tag values from backup data stored in the issue rows. Only supported for tag-writing types (`corrupted`, `missing`). Orphans and duplicates cannot be reverted.

Default mode `"undo"` sets status back to `DETECTED`. Mode `"undo-resolved"` keeps `RESOLVED` status.

## Build

```bash
cd scripts/fix && cargo build --release
```
