# Scripts: sync

Queries artists where `lastIndexedAt > lastSyncedAt` and `relatedOnly = false`, then syncs each against MusicBrainz. No MUSIC_DIR access — reads entirely from DB and calls MB API.

Sync skips `relatedOnly=true` artists — those are guests/collaborators identified by the index and don't need MB enrichment.

Run after `./index`, or independently to re-sync without re-indexing.

## Build

```bash
cd scripts && cargo build --release -p sync
```

## Usage

```bash
./sync                           # Sync all pending artists
./sync --only="radiohead"        # Single artist
./sync --from="A" --to="M"       # Letter range
./sync --overwrite               # Re-sync all (ignores lastSyncedAt)
./sync --skip-artist-img         # Skip artist image downloads
./sync --skip-release-img        # Skip cover art downloads
./sync --verbose                 # Show skipped MB releases
./sync --delete                  # Delete MB data for matched artists, then exit
./sync --web                     # Emit PROGRESS:{json} for the web terminal
```

## Output modes

Without `--web`, the script prints colored, indented progress (artist headers, `→` step lines, `✓` success marks, MusicBrainz rate-limit countdown). With `--web`, it emits `PROGRESS:{json}` lines consumed by the web UI progress bar, plus plain text for the terminal panel. The web UI appends `--web` automatically when invoking scripts.

## Per-Artist Flow

1. **Find MB match** — 5-step algorithm (see below)
2. **Fetch** artist detail: URLs, genres
3. **Download** artist image (Wikidata → Wikipedia → Fanart.tv), resize to 500px
4. **Fetch** release groups (paginated)
5. **For each local release** — 4-tier matching:
   - Tier 1: Direct release lookup via embedded `MUSICBRAINZ_ALBUMID`
   - Tier 2: Release group lookup via `MUSICBRAINZ_RELEASEGROUPID`, pick best release by track count
   - Tier 3: Title matching against release groups, pick best release
   - Tier 4: No match — skip gracefully
6. **Link** LocalReleaseTrack → MusicBrainzReleaseTrack where titles match
7. **Download** cover art from Cover Art Archive (release-level first, release-group fallback), resize to 500px
8. **Set `lastSyncedAt`** on Artist

## --delete behaviour

Resets `musicbrainzId`, `averageMatchScore`, and `lastSyncedAt` to NULL on matched artists, unlinks all `MusicBrainzRelease` records, and resets `LocalRelease.matchStatus` to `UNKNOWN`.

After `--delete`, re-running `./sync` (without `--overwrite`) automatically re-syncs those artists because `lastSyncedAt IS NULL` satisfies the pending-sync query.

## Artist Matching (5-step)

1. Embedded MB artist ID in any track tag → direct lookup
2. Embedded MB album ID → release-group credits lookup
3. Name search (phrase-quoted, score ≥ 90, Jaccard ≥ 0.5)
4. Raw track artist tag search (when differs from album artist)
5. Release-group credits search by album title + artist name

## Match Status

| Status | Meaning |
|--------|---------|
| `COMPLETE` | All MB tracks matched to local tracks |
| `INCOMPLETE` | Some MB tracks unmatched |
| `EXTRA_TRACKS` | More local tracks than MB tracks |
| `MISSING_TRACKS` | MB has tracks not found locally |
| `UNSYNCABLE` | No matching release group found |

## Rate Limiting

Adaptive backoff: 1100ms–10s per request, adjusted via `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. Retries up to 6× on 429/503 with exponential backoff (1s→2s→4s→8s→16s cap).

## Release Deduplication

Index creates one `LocalRelease` per folder — so the same album in two folders (original + compilation) produces separate rows. Sync is what merges them: it links each `LocalRelease.releaseId` → `MusicBrainzRelease.id`. The web UI groups by MB release, so multiple local copies collapse into one card with the MB title, type, and artwork.

Before sync, all local releases appear as separate unmatched cards.

## Multi-Edition Handling

Multiple editions of the same album (original, remaster, deluxe) are stored as separate `MusicBrainzRelease` rows. Each row stores:
- `musicbrainzId` — specific MB release ID (unique per edition)
- `releaseGroupId` — MB release group ID (shared across editions)
- `disambiguation` — edition label from MB ("2009 Remaster", "Deluxe Edition")

Cover art fetched per-release first, falling back to release-group art.

## Running on NAS

```bash
docker exec dmp sync --from=e --to=fz
```
