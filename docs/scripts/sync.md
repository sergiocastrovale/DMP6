# Scripts: sync

Queries artists where `lastIndexedAt > lastSyncedAt` and `relatedOnly = false`, then syncs each against MusicBrainz. Reads from DB and calls MB API. Writes to audio files when embedding downloaded cover art.

Skips `relatedOnly=true` artists — guests/collaborators don't need MB enrichment.

## Build

```bash
cd scripts && cargo build --release -p sync
```

## Usage

```bash
./sync                           # Sync all pending artists
./sync --only "radiohead"        # Single artist (prefix match)
./sync --only "Air" --exact      # Exact match (won't catch "Airbag")
./sync --from "A" --to "M"      # Letter range
./sync --release "clxxxxxxx"    # Re-sync a single release by LocalRelease ID
./sync --overwrite               # Re-sync all (ignores lastSyncedAt)
./sync --skip-artist-img         # Skip artist image downloads
./sync --skip-release-img        # Skip cover art downloads
./sync --verbose                 # Show skipped MB releases
./sync --delete                  # Delete MB data for matched artists, then exit
./sync --web                     # Emit PROGRESS:{json} for the web terminal
```

`--release` cannot combine with `--from`, `--to`, or `--only`.

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--from` / `-f` | String | — | Start letter filter |
| `--to` / `-t` | String | — | End letter filter |
| `--only` / `-o` | String | — | Artist filter (semicolon-separated) |
| `--exact` | bool | false | Exact match for `--only` (no prefix matching) |
| `--release` | String | — | Re-sync single release by LocalRelease ID |
| `--overwrite` | bool | false | Re-sync all matched (not just pending) |
| `--skip-artist-img` | bool | false | Skip artist image download |
| `--skip-release-img` | bool | false | Skip release cover download |
| `--delete` | bool | false | Nuke MB data for matched artists, then exit |
| `--verbose` | bool | false | Log skipped/already-synced releases |
| `--web` | bool | false | Emit PROGRESS:{json} for web terminal |

## Output Modes

Without `--web`: colored console progress with rate-limit countdown. With `--web`: `PROGRESS:{json}` lines for the web UI. The web UI appends `--web` automatically.

## Per-Artist Flow

1. **Find MB match** — 5-step algorithm (see below)
2. **Fetch** artist detail: URLs, genres (top 5 by count), tags
3. **Download** artist image (Wikidata → Wikipedia → Fanart.tv), resize to 500px
4. **Fetch** release groups (paginated)
5. **For each local release** — 2-tier matching:
   - Tier 1: Direct release lookup via embedded `MUSICBRAINZ_ALBUMID` (majority vote across tracks)
   - Tier 2: Release group browse via `MUSICBRAINZ_RELEASEGROUPID` (or Tier 1 404 fallback)
   - No MB IDs in tags → marked Unmatched, skipped
6. **Link** LocalReleaseTrack → MusicBrainzReleaseTrack where titles match
7. **Cover art** — download from Cover Art Archive (release-level first, release-group fallback), embed into audio file tags, then re-extract 200x200 thumbnails via same pipeline as index (`common/src/images.rs`)
8. **Set `lastSyncedAt`** on Artist, compute average match score

Duplicate detection: tracks processed MB IDs across the run. Skips artists that resolve to an already-processed MB artist.

## --delete Behaviour

Resets `musicbrainzId`, `averageMatchScore`, and `lastSyncedAt` to NULL, unlinks `MusicBrainzRelease` records, resets `LocalRelease.matchStatus` to `UNMATCHED`. Re-running `./sync` after this automatically re-syncs those artists.

## Artist Matching (5-step)

1. Embedded MB artist ID in any track tag → direct lookup
2. Embedded MB album ID → release-group credits lookup
3. Name search (phrase-quoted, score >= 90, Jaccard >= 0.5)
4. Raw track artist tag search (when differs from album artist)
5. Release-group credits search by album title + artist name

If artist already has a MB ID and not overwriting: uses it directly (no API search).

## Release Matching Policy

Strict metadata-wins: only matches via embedded MB IDs in tags. Title fuzzy matching is intentionally disabled. Releases without MB IDs in tags are marked `UNMATCHED`. Confidence check: if multiple siblings returned and none match local track count exactly, marks `UNMATCHED`.

## Release Status

All statuses in `ReleaseStatus` enum and how they are assigned:

| Status | Score | How assigned | Badge color |
|--------|-------|--------------|-------------|
| `COMPLETE` | 1.0 | Sync: all MB tracks matched to local tracks (0 unmatched on both sides) | Green |
| `EXTRA_TRACKS` | 0.85 | Sync: more local tracks than MB tracks | Blue |
| `MISSING_TRACKS` | 0.7 | Sync: MB has tracks not found locally | Orange |
| `INCOMPLETE` | 0.5 | Sync: fallback when some local tracks are unmatched | Amber |
| `MISSING` | — | API-only: MB release exists in artist catalogue but no local files | Red |
| `UNKNOWN` | — | Index: track deletion resets matched release for sync recalculation. Release still has `releaseId`. | Gray |
| `UNMATCHED` | — | Index: new release (no MB match yet). Sync: no MB IDs in tags, or ambiguous match (multiple MB siblings, no exact track-count match). Nuke: unlink from MB. | Beige |

### Status lifecycle

1. **Index creates** a new `LocalRelease` → `UNMATCHED` (no MB link yet)
2. **Sync matches** release to MB → `COMPLETE`/`EXTRA_TRACKS`/`MISSING_TRACKS`/`INCOMPLETE`
3. **Sync can't match** (no MB tags or ambiguous) → stays `UNMATCHED`
4. **Track deletion** on a matched release → `UNKNOWN` (needs sync recalculation, `releaseId` kept)
5. **Nuke/delete** unlinks from MB → `UNMATCHED` (`releaseId` cleared)
6. **Re-sync** (`--overwrite`) → re-evaluates, lands on any of the above

## Rate Limiting

Adaptive backoff: 1100ms–10s per request, adjusted via `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. Retries up to 6x on 429/503 with exponential backoff (1s → 16s cap).

## Release Deduplication

Index creates one `LocalRelease` per folder. Sync merges them by linking `LocalRelease.releaseId` → `MusicBrainzRelease.id`. The web UI groups by MB release, collapsing multiple local copies into one card.

## Multi-Edition Handling

Multiple editions (original, remaster, deluxe) stored as separate `MusicBrainzRelease` rows sharing a `releaseGroupId`. Each has its own `musicbrainzId` and `disambiguation` label. Cover art fetched per-release first, falling back to release-group art.

## Locking

Named DB lock (`"sync"`). Clears stale locks older than 10 min. SIGTERM/Ctrl-C handlers release the lock; second Ctrl-C force-exits.

## Running on NAS

```bash
docker exec dmp sync --from=e --to=fz
```
