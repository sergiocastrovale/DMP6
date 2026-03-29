# Scripts: sync

Matches local artists against MusicBrainz, fetches discography, downloads artist images, and sets release match status.

## Build

```bash
cd scripts/sync && cargo build --release
```

## Usage

```bash
./sync                           # Sync artists that need it
./sync --overwrite               # Re-sync all artists
./sync --only="Radiohead"        # Only artists matching prefix
./sync --from="A" --to="M"      # Sync range
./sync --limit=10                # Limit to first N artists
./sync --resume                  # Continue from last completed artist
./sync --verbose                 # Show skipped releases in output
```

## Per-Artist Flow

For each artist (no `musicbrainzId`, or `--overwrite`):

1. **Search** MusicBrainz by name (with fallback strategies)
2. **Fetch** artist details: URLs, genres, tags, image
3. **Fetch** release groups and tracks
4. **Filter** releases: skip Singles, Bootlegs, Demos, Interviews, Broadcasts
5. **Create** MusicBrainzRelease + MusicBrainzReleaseTrack records
6. **Download** artist image (Wikipedia/Wikidata, then Fanart.tv; 200x200 JPEG)
7. **Set match status** per release: `COMPLETE`, `INCOMPLETE`, `EXTRA_TRACKS`, `MISSING`, `UNSYNCABLE`, `UNKNOWN`
8. **Save progress** to `Statistics.lastSyncedArtist`

## Resume

- Progress is saved to `Statistics.lastSyncedArtist` after each artist completes
- `--resume` skips all artists with slug <= the saved value
- A normal run (no `--resume`) clears any stale progress

## Artist Matching

- Quoted phrase search (`artist:"Name"`) with score >= 90 + Jaccard similarity >= 50%
- Single-token names require exact match
- Fallback: try raw `artist` tag, then split `albumArtist` by `, ` / ` & ` / ` vs ` / ` feat. ` / ` – `

## Rate Limiting

- Starts at 1s between requests
- Doubles delay on 503/429 (up to 10s), reduces by 15% on success (down to 1s)
- Up to 10 retries per request with exponential backoff

## Error Handling

- Errors logged to `errors.log` with `[timestamp][SYNC]` prefix
- Non-fatal; syncing continues with next artist
- Failed artists listed in final summary
