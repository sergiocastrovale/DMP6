# Scripts: sync

Queries pending artists (`lastIndexedAt > lastSyncedAt`) and syncs each against MusicBrainz. Uses a run hash for resumability — interrupted runs skip already-processed artists. Reads from DB and calls MB API. Writes found MB IDs back to audio file tags (preserving mtime to avoid re-index) and embeds downloaded cover art.

Skips `relatedOnly=true` artists — guests/collaborators don't need MB enrichment.

## TL;DR

1. Load config, connect DB, acquire process lock (prevents concurrent runs)
2. Select artists: `--release` (single), `--overwrite` (all), or default (pending where `lastIndexedAt > lastSyncedAt`). Skip artists already processed in current run (matching `syncHash`)
3. **Per artist:**
   - Skip special names (Various Artists, [unknown])
   - Find on MusicBrainz — use existing MB ID or search API; skip duplicates (same MB ID as previous artist)
   - Persist MB ID and country code (from MB area ISO 3166-1), fetch artist details (genres, tags, URLs), upsert to DB
   - Download artist image if missing (Wikidata → Wikipedia → Fanart.tv → local/S3)
   - Fetch release groups from MB API
4. **Per release (within artist):**
   - Skip already-synced unless `--overwrite`
   - Match via embedded MB IDs: Tier 1 (MUSICBRAINZ_ALBUMID) → Tier 2 (MUSICBRAINZ_RELEASEGROUPID) → no match = UNMATCHED
   - Compare local vs MB track counts → status: COMPLETE / EXTRA_TRACKS / MISSING_TRACKS / INCOMPLETE
   - If ambiguous (multiple editions, no exact track-count match) → UNMATCHED
   - Upsert MB release, link tracks, update local release match status
5. **Cover art (batched per artist):** download from Cover Art Archive, embed into audio files, extract thumbnail → `img/releases/` (local/S3)
6. **Cleanup:** update artist sync stats + global statistics, delete orphan MB releases, release lock

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
./sync --catalogue-gaps          # Fast pass: populate MISSING catalogue entries only (1 API call/artist)
./sync --catalogue-gaps --only x # Gaps for specific artist
./sync --catalogue-gaps --overwrite # Re-fetch all MISSING entries from scratch
./sync --skip-mb-tags            # Skip writing MB IDs back to file tags
./sync --only-write-mb-to-files  # Backfill DB-known MB IDs into file tags (no API calls)
./sync --only-write-mb-to-files --only "radiohead"  # Backfill specific artist
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
| `--catalogue-gaps` | bool | false | Fast pass: only populate MISSING catalogue entries (1 API call/artist) |
| `--skip-mb-tags` | bool | false | Skip writing found MB IDs back into audio file tags |
| `--only-write-mb-to-files` | bool | false | Backfill DB-known MB IDs into file tags (no API calls), then exit |
| `--verbose` | bool | false | Log skipped/already-synced releases |
| `--web` | bool | false | Emit PROGRESS:{json} for web terminal |

## Output Modes

Without `--web`: colored console progress with rate-limit countdown. With `--web`: `PROGRESS:{json}` lines for the web UI. The web UI appends `--web` automatically.

## Per-Artist Flow

1. **Find MB match** — 5-step algorithm (see below)
2. **Fetch** artist detail: URLs, genres (top 5 by count), tags, country (from `area.iso-3166-1-codes`)
3. **Download** artist image (Wikidata → Wikipedia → Fanart.tv), resize to 500px
4. **Fetch** release groups (paginated)
5. **For each local release** — 2-tier matching:
   - Tier 1: Direct release lookup via embedded `MUSICBRAINZ_ALBUMID` (majority vote across tracks)
   - Tier 2: Release group browse via `MUSICBRAINZ_RELEASEGROUPID` (or Tier 1 404 fallback)
   - No MB IDs in tags → marked Unmatched, skipped
6. **Link** LocalReleaseTrack → MusicBrainzReleaseTrack where titles match
7. **Write MB IDs** back to audio file tags (`MUSICBRAINZ_ALBUMARTISTID`, `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_TRACKID`) — only writes tags that differ, preserves file mtime to avoid triggering re-index. Skipped with `--skip-mb-tags`
8. **Cover art** — download from Cover Art Archive (release-level first, release-group fallback), embed into audio file tags, then re-extract 200x200 thumbnails via same pipeline as index (`common/src/images.rs`)
9. **Set `lastSyncedAt`** on Artist, persist country code, compute average match score
10. **Stamp run hash** on Artist for resumability

Duplicate detection: tracks processed MB IDs across the run. Skips artists that resolve to an already-processed MB artist.

## --catalogue-gaps Behaviour

Fast path for populating MISSING MusicBrainzRelease entries without re-running the full sync. Requires artists to already have `musicbrainzId` in DB (from a previous full sync).

**Per artist (1 API call):**
1. Use existing `musicbrainzId` from DB (no search/lookup)
2. Fetch release groups from MB API (sole API call)
3. Query existing artist genres from DB (no API call)
4. If `--overwrite`, delete stale MISSING entries first; otherwise skip release groups that already have MISSING entries
5. Create MISSING entries for uncovered Album/EP release groups + link genres

**Skips entirely:** artist search, artist detail fetch, URL upsert, artist image, local release matching, cover art download.

**Skip logic:** Without `--overwrite`, existing MISSING releases are preserved and only new gaps are added. With `--overwrite`, all MISSING releases are deleted and re-created from scratch.

**Performance:** ~1.1s per artist (rate limit). 500 artists ≈ 9 minutes vs ~7 days for full sync.

Cannot combine with `--release` or `--delete`. Compatible with `--from`/`--to`/`--only`/`--exact`/`--overwrite`/`--web`/`--verbose`.

## --only-write-mb-to-files Behaviour

Writes DB-known MB IDs back into audio file tags. No API calls — reads entirely from DB. Only fills in **absent** tags; never overwrites existing file values. Preserves file mtime to avoid triggering re-index.

**Per artist:** queries all matched tracks (joined through LocalRelease → MusicBrainzRelease → MusicBrainzReleaseTrack), writes missing `MUSICBRAINZ_ALBUMARTISTID`, `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, and `MUSICBRAINZ_TRACKID` tags.

**Use case:** backfill tags after a full sync so files become source of truth. Run once after initial sync to persist all found MB IDs into files.

Cannot combine with `--release`, `--delete`, or `--catalogue-gaps`. Compatible with `--from`/`--to`/`--only`/`--exact`.

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

Found MB IDs are written back to file tags after matching, so future syncs (or DB rebuilds) can skip expensive MB searches. The writeback preserves file mtime to avoid triggering re-index.

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

## Locking & Resumability

Named DB lock (`"sync"`). Clears stale locks older than 10 min. SIGTERM/Ctrl-C handlers release the lock; second Ctrl-C force-exits.

Run hash stored in `Settings.syncRunHash`. On restart, artists already processed (matching `Artist.syncHash`) are skipped. Hash cleared on completion. `--overwrite` generates a new hash. `--release` bypasses hash.

## Running on NAS

```bash
docker exec dmp sync --from=e --to=fz
```
