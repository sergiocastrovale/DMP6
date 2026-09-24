# Scripts: fix

Reads `PENDING` issue rows from the DB and applies the corresponding fix: tag writes for corrupted/missing issues, DB-only operations for orphans and duplicates.

Issues are detected by `./audit` and queued via the `/issues` web UI (or directly via `POST /api/issues/{type}/queue`).

## Usage

```bash
./fix --corrupted    # Fix corrupted albumArtist tags
./fix --orphans      # Delete orphan/phantom artists from DB
./fix --duplicates   # Merge duplicate artists (B into A)
./fix --missing      # Write proposed values for tracks with missing metadata
./fix --revert --corrupted   # Revert already-applied corrupted fixes
./fix --revert --missing     # Revert already-applied missing fixes
./fix --revert --mode undo-resolved --corrupted  # Revert but keep RESOLVED status
./fix --missing --dry-run    # Print what would be written, touch nothing
```

All fix types can be combined in one invocation. Only rows with `status = 'PENDING'` are processed. Exits with error if no type flag given, or if `--dry-run` is combined with `--revert` (not supported).

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--corrupted` | bool | false | Fix corrupted TPE2 issues |
| `--orphans` | bool | false | Fix orphan artists (delete) |
| `--duplicates` | bool | false | Fix duplicate artists (merge B into A) |
| `--missing` | bool | false | Fix missing metadata (tag writes) |
| `--revert` | bool | false | Revert already-applied fixes instead of fixing |
| `--mode` | `undo` \| `undo-resolved` | `undo` | Revert mode: back to `DETECTED`, or stays `RESOLVED` |
| `--dry-run` | bool | false | Print what each fixer would change; writes nothing (file, DB, or statistics) |

## Auto Re-index

After tag-writing fixes (corrupted, missing), fix automatically invokes the sibling `index` binary with `--folders <affected_folders> --skip-covers` to re-index changed files. Only triggers when file writes actually happened.

## Fix Logic Per Type

### `--corrupted`

Reads `IssueCorruptedTpe2` rows where `status = 'PENDING'`. For each:
1. Opens the audio file at `track.filePath` (resolved against `MUSIC_DIR`)
2. Writes `proposedValue` as the new `albumArtist` tag (TPE2/ALBUMARTIST/aART)
3. Bumps parent directory mtime (creates and deletes `.fix-touch`) so the follow-up index run sees the folder as changed
4. Marks issue as `RESOLVED` or `FAILED`

### `--orphans`

Reads `IssueOrphanArtist` rows where `status = 'PENDING'`. For each:
1. Re-checks the artist is still unlinked (no owned/credited release) right before deleting - an issue whose artist gained a link since the audit is stale and is dropped instead of deleted.
2. `DELETE FROM "Artist" WHERE id = $artistId` - cascades to ArtistUrl, junction tables, TrackRelatedArtist
3. Deletes the artist's image file(s), only now that the row is gone

No file tag changes. Cannot be reverted.

### `--duplicates`

Reads `IssueDuplicateArtist` rows where `status = 'PENDING'`. For each pair (A = keep, B = merge):
1. Rewrites B's name to A's name (whole-word, case-insensitive) in every affected file's `artist`/`albumArtist` tags
2. One transaction: re-points `LocalReleaseArtist`, `TrackRelatedArtist`, `MusicBrainzReleaseArtist`, `_ArtistGenres`, `ArtistUrl`, `DownloadedRelease`, and any `primaryArtistId` rows from B to A (deduping conflicts first), then `DELETE FROM "Artist" WHERE id = $artistBId`
3. Deletes B's image file(s), only now that the row is gone

Artist A's image, MusicBrainz ID, and stats are preserved (play counts are per-user, computed at read time through the now-retargeted ownership link, so nothing needs folding there). Cannot be reverted.

### `--missing`

Reads `IssueMissingMetadata` rows where `status = 'PENDING'` and `proposedValues IS NOT NULL`. For each:
1. Opens the audio file
2. Writes any proposed fields (`albumArtist`, `artist`, `album`, `year`)
3. Bumps directory mtime
4. Marks `RESOLVED` or `FAILED`

Rows where `proposedValues` is null (title/album with no derivable value) are skipped.

## Revert

`--revert` restores each file's `previousState` from its `FixHistory` row (one per fix, `appliedAt DESC`). Only supported for tag-writing types (`corrupted`, `missing`). Orphans and duplicates cannot be reverted.

The `FixHistory` row and the issue's `RESOLVED` status are committed together, only after the tag write succeeds - a crash between writing the file and recording what it replaced would otherwise leave a mutated file with nothing to revert it from.

Default mode `undo` sets status back to `DETECTED`. Mode `undo-resolved` keeps `RESOLVED` status.

## Build

```bash
cd scripts/fix && cargo build --release
```
