# Scripts: dmp-sync

Queries artists where `lastIndexedAt > lastSyncedAt` and syncs each against MusicBrainz. No MUSIC_DIR access — reads entirely from DB and calls MB API.

Run after `./index`, or independently to re-sync without re-indexing.

## Build

```bash
cd scripts && cargo build --release -p dmp-sync
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
```

## Per-Artist Flow

1. **Find MB match** — 6-step algorithm (see below)
2. **Fetch** artist detail: URLs, genres
3. **Download** artist image (Wikidata → Wikipedia → Fanart.tv), resize to 500px
4. **Fetch** release groups (paginated)
5. **For each local release** — find matching release group by title, upsert MB release + tracks
6. **Link** LocalReleaseTrack → MusicBrainzReleaseTrack where titles match
7. **Download** cover art from Cover Art Archive, resize to 500px
8. **Set `lastSyncedAt`** on Artist

## --delete behaviour

Resets `musicbrainzId`, `averageMatchScore`, and `lastSyncedAt` to NULL on matched artists, unlinks all `MusicBrainzRelease` records, and resets `LocalRelease.matchStatus` to `UNKNOWN`.

After `--delete`, re-running `./sync` (without `--overwrite`) automatically re-syncs those artists because `lastSyncedAt IS NULL` satisfies the pending-sync query.

## Artist Matching (6-step)

1. Embedded MB artist ID in any track tag → direct lookup
2. Embedded MB album ID → release-group credits lookup
3. Name search (phrase-quoted, score ≥ 90, Jaccard ≥ 0.5)
4. Raw track artist tag search (when differs from album artist)
5. Release-group credits search by album title + artist name
6. Tag splitting — split compound names on feat./vs. and search parts

## Match Status

| Status | Meaning |
|--------|---------|
| `COMPLETE` | All MB tracks matched to local tracks |
| `INCOMPLETE` | Some MB tracks unmatched |
| `EXTRA_TRACKS` | More local tracks than MB tracks |
| `UNSYNCABLE` | No matching release group found |

## Rate Limiting

Adaptive backoff: 250ms–10s per request, adjusted via `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. Retries up to 10× on 429/503 with exponential backoff.

## NAS One-Liner

```bash
docker run --rm --env-file /mnt/SSD/web/dmp/.env --add-host=host.docker.internal:host-gateway -e PROJECT_ROOT=/app -e MUSIC_DIR=/music -v /mnt/dmp/music/mainstream:/music:ro -v /mnt/SSD/web/dmp/img:/app/web/public/img dmp-scripts:latest dmp-sync --from=e --to=fz
```
