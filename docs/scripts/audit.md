# Scripts: audit

Scans the database for metadata issues and persists them in typed issue tables. Each run wipes and repopulates all detected rows, linked to a new `AuditRun` record.

The results drive the `/issues` web UI — run audit first, then review and fix from the browser.

## Usage

```bash
./audit                  # Detect all issue types
./audit --corrupted      # Only corrupted TPE2 tags
./audit --unsplit        # Only compound artist names
./audit --orphans        # Only orphan/phantom artists
./audit --duplicates     # Only artists with duplicate normalized names
./audit --missing        # Only tracks with missing core metadata fields
```

## Issue Types

### Corrupted TPE2 (`IssueCorruptedTpe2`)

Tracks where `albumArtist` is clearly garbage — track numbers, years, file paths, or bitrate markers leaked into the TPE2 field.

Detection patterns:
- `^\d{1,3}$` — bare track number (`"02"`, `"14"`)
- `^\d{1,3}\s*-\s*\S` — track-number prefix (`"05 - Something"`)
- `@\d{2,3}$` — bitrate suffix (`"Artist @320"`)
- `%lbumArtist/` — broken field-name prefix
- `albumArtist == year` — year leaked from another field

For each detected track, the proposed fix is derived from peer tracks in the same release (majority vote). Confidence: `high` (≥ 3 peers), `medium` (1–2 peers), `low` (TPE1 fallback).

**Fix:** `./fix --corrupted` writes the proposed `albumArtist` value to the tag file.

### Unsplit Artists (`IssueUnsplitArtist`)

Artists in the DB whose name contains multi-artist separators: `&`, `feat.`, `ft.`, `/`, `;`.

Detection skips a hardcoded list of known-single artists (AC/DC, Simon & Garfunkel, Kool & the Gang, etc.).

`proposedParts` contains the split result (e.g. `["Jeff Beck", "Eric Clapton"]`).

**Fix:** `./fix --unsplit` writes:
- `albumArtist` (TPE2) = first proposed part (primary/album artist)
- `artist` (TPE1) = original compound name (preserves multi-artist credit)

After fixing tags, run `./refresh --only="ArtistName"` to rebuild DB records.

### Orphan Artists (`IssueOrphanArtist`)

Artists that shouldn't exist:

| Reason | Meaning |
|--------|---------|
| `phantom` | Name matches `^\d{1,3}$` or `@\d{2,3}$` — created by corrupted tags |
| `no_releases` | No `LocalReleaseArtist` links |
| `no_tracks` | Has releases but no `TrackArtist` links |

**Fix:** `./fix --orphans` deletes the artist and any local image file.

### Duplicate Artists (`IssueDuplicateArtist`)

Pairs of artists whose names normalize to the same string (stripping non-alphanumeric) — caused by spelling differences or unicode variants.

Skips pairs where both have distinct MusicBrainz IDs (confirmed different entities).

`artistAId` = canonical (higher track count), `artistBId` = to be merged.

**Fix:** `./fix --duplicates` re-points all junction rows (LocalReleaseArtist, TrackArtist, MusicBrainzReleaseArtist) from B to A, then deletes B and its image.

### Missing Metadata (`IssueMissingMetadata`)

Tracks with NULL or empty `title`, `artist`, `albumArtist`, `album`, or `year`.

`missingFields` lists which fields are absent. `proposedValues` contains auto-derivable values:
- Missing `albumArtist` → proposed from `artist`
- Missing `artist` → proposed from `albumArtist`
- Missing `year` → majority year from other tracks in the same release
- Missing `title`/`album` → no proposal (manual fix only)

**Fix:** `./fix --missing` writes proposed values to tag files (skips rows where `proposedValues` is null).

## Workflow

```bash
./audit                          # Detect all issues, write to DB
# Open /issues in browser — review, edit proposed values, select rows
# Click "Fix Selected" per type — queues rows as PENDING, runs ./fix --{type}
# After fix completes: click "Refresh" for affected artists
./audit                          # Re-run to verify
```

## Build

The binary is at `scripts/audit/`. Build standalone:

```bash
cd scripts/audit && cargo build --release
```

Or rebuild the full workspace:

```bash
cd scripts && cargo build --release
```
