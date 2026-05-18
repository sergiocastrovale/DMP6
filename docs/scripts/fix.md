# Scripts: fix

Reads `PENDING` issue rows from the DB and applies the corresponding fix: tag writes for corrupted/unsplit/missing issues, DB-only operations for orphans and duplicates.

Issues are detected by `./audit` and queued via the `/issues` web UI (or directly via `POST /api/issues/{type}/queue`).

## Usage

```bash
./fix --corrupted    # Fix corrupted albumArtist tags
./fix --unsplit      # Fix compound artist names in albumArtist → split between TPE1/TPE2
./fix --orphans      # Delete orphan/phantom artists from DB
./fix --duplicates   # Merge duplicate artists (B into A)
./fix --missing      # Write proposed values for tracks with missing metadata
```

All types can be combined in one invocation. Only rows with `status = 'PENDING'` are processed.

## Fix Logic Per Type

### `--corrupted`

Reads `IssueCorruptedTpe2` rows where `status = 'PENDING'`. For each:
1. Opens the audio file at `track.filePath` (resolved against `MUSIC_DIR`)
2. Writes `proposedValue` as the new `albumArtist` tag (TPE2/ALBUMARTIST/aART)
3. Bumps parent directory mtime (creates and deletes `.fix-touch`) so `./index --quick` detects the change
4. Marks issue as `RESOLVED` or `FAILED`

### `--unsplit`

Reads `IssueUnsplitArtist` rows where `status = 'PENDING'`. For each:
1. Gets all track file paths linked to the compound artist via `LocalReleaseArtist`
2. For each file: writes `proposedParts[0]` to `albumArtist` (TPE2) — the primary artist only
3. Writes the full compound artist name to `artist` (TPE1) — preserves the multi-artist credit where it belongs
4. Bumps directory mtime
5. Marks issue `RESOLVED` or `FAILED`

**Why this split:** `albumArtist` (TPE2) is for the album's primary artist — used for grouping/sorting. `artist` (TPE1) is the track-level performing artist list — can be compound.

After `./fix --unsplit`, run `./refresh --only="ArtistName"` to rebuild DB records from the corrected tags.

### `--orphans`

Reads `IssueOrphanArtist` rows where `status = 'PENDING'`. For each:
1. Deletes the artist's local image file (if set)
2. `DELETE FROM "Artist" WHERE id = $artistId` — cascades to ArtistUrl, junction tables, TrackRelatedArtist

No file tag changes. No re-index needed.

### `--duplicates`

Reads `IssueDuplicateArtist` rows where `status = 'PENDING'`. For each pair (A = keep, B = merge):
1. Re-points `LocalReleaseArtist`, `TrackRelatedArtist`, `MusicBrainzReleaseArtist` rows from B to A (skipping conflicts)
2. Deletes remaining B junction rows
3. Deletes B's local image file
4. `DELETE FROM "Artist" WHERE id = $artistBId`

Artist A's image, MusicBrainz ID, and stats are preserved unchanged.

### `--missing`

Reads `IssueMissingMetadata` rows where `status = 'PENDING'` and `proposedValues IS NOT NULL`. For each:
1. Opens the audio file
2. Writes any proposed fields (`albumArtist`, `artist`, `album`, `year`)
3. Bumps directory mtime
4. Marks `RESOLVED` or `FAILED`

Rows where `proposedValues` is null (title/album with no derivable value) are skipped — manual fix required.

## Post-Fix Workflow

After fixing tag-writing types (`corrupted`, `unsplit`, `missing`), re-index and re-sync affected artists:

```bash
./refresh --only="Artist1;Artist2"
# or use the "Refresh" button in the web UI
```

After `orphans` and `duplicates` (DB-only), no re-index needed — statistics are updated automatically.

## Build

```bash
cd scripts/fix && cargo build --release
```
