# Scripts: sync

Fetches MusicBrainz data, matches releases, downloads artist images.

## Build

Scripts auto-build on first run. To build manually:

```bash
cd scripts/sync && cargo build --release
```

### Usage

```bash
# Sync artists that need it
./sync

# Re-sync all artists
./sync --overwrite

# Sync specific artist
./sync --only="Radiohead"

# Sync range of artists
./sync --from="A" --to="M"

# Sync with limit
./sync --limit=10

# Combined filters
./sync --only="Radio" --overwrite
./sync --from="A" --to="D" --limit=100
```

### CLI Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--overwrite` | false | Re-sync all artists (including already synced ones) |
| `--only PREFIX` | | Only sync artists starting with prefix (case insensitive) |
| `--from PREFIX` | | Sync artists starting from prefix (case insensitive) |
| `--to PREFIX` | | Sync artists up to prefix (case insensitive) |
| `--limit N` | 0 (no limit) | Limit to first N artists |

### How it works

For each artist that needs syncing (no `musicbrainzId`, or `lastSyncedAt` older than 30 days, or `--overwrite` flag):

1. **Search** MusicBrainz for the artist (by name or existing MB ID)
   - **Note**: "Various Artists" is automatically skipped (compilation marker, not a real artist)
2. **Fetch** complete discography (release groups)
3. **Filter** releases: skip Singles, Bootlegs, Demos, Interviews, Broadcasts
4. **Create** MusicBrainzRelease and MusicBrainzReleaseTrack records
5. **Store** genres/tags and artist URLs
6. **Download** artist image (Wikipedia/Wikidata first, then Fanart.tv; 200x200 JPEG)
7. **Status check** per release:
   - `COMPLETE` - All MB tracks found locally
   - `INCOMPLETE` - Some tracks missing locally
   - `EXTRA_TRACKS` - More local tracks than MB
   - `MISSING` - MB release not in local catalogue
   - `UNSYNCABLE` - No MB ID on local release
   - `UNKNOWN` - Has MB ID but not found online
8. **Calculate** `averageMatchScore` per artist
9. Set `musicbrainzId` and `lastSyncedAt`

### Rate Limiting

Adaptive strategy to respect MusicBrainz API limits:
- Starts at 100ms between requests
- Backs off to 1.5s on 503/429 responses
- Gradually reduces delay on success
- Retries up to 3 times per request

### Error Logging

All sync errors are logged to `errors.log` (project root):
- Each error is prefixed with `[SYNC]`
- Errors include: artist search failures, release fetch failures, DB errors, API errors
- Errors are non-fatal; syncing continues with next artist
- Example: `[SYNC] No MusicBrainz match for artist: Unknown Band`