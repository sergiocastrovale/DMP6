# Scripts

## Indexer (`./index`)

Scans audio files, extracts metadata, and populates the database.

## Build

Scripts auto-build on first run. To build manually:

```bash
cd scripts/index && cargo build --release
```

### Usage

```bash
# Basic usage (reads MUSIC_DIR from .env)
./index

# Override music directory
./index /path/to/music

# Full re-index (deletes existing data first)
./index --overwrite

# Scan specific range
./index --from r --to s

# Only scan folders starting with "radiohead"
./index --only radiohead

# Resume interrupted scan
./index --resume

# Skip cover art extraction
./index --skip-images

# Limit threads and file count
./index --threads 4 --limit 1000
```

### How it works

1. **Walk** the music directory for audio files (mp3, flac, aac, opus, m4a, ogg)
2. **Extract** metadata using `lofty` crate (fast, Rust-native)
3. **Change detection**:
   - If `mtime + fileSize` match existing record: skip entirely
   - If changed, compute `contentHash` (MD5 of key fields). If hash matches: update mtime only
   - If hash differs: full metadata update
4. **Write** Artist, LocalRelease, LocalReleaseTrack, and TrackArtist records
   - **Note**: "Various Artists" is automatically skipped (compilation marker, not a real artist)
5. **Extract** cover art from first track per release (200x200 JPEG)
6. **Update** release and artist totals

### Checkpoint/Resume

The indexer saves progress to the `IndexCheckpoint` table every 100 files. Use `--resume` to continue from where you left off after an interruption.

### Error Handling

- Files with missing artist tag are skipped and logged to `errors.log`
- Each track is committed individually (one failure doesn't affect others)
- Errors are non-fatal; indexing continues

## MusicBrainz Sync (`./sync`)

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

## Nuke (`./nuke`)

Completely deletes all database tables and image files. **Destructive operation** - use with caution!

### Usage

```bash
./nuke
```

### What it does

1. Truncates all database tables

2. Deletes local image files

3. Deletes S3 images (if `IMAGE_STORAGE=s3` or `IMAGE_STORAGE=both`)

### Error Handling

- Errors are logged to `errors.log` with `[NUKE]` prefix
- Non-fatal: continues with next operation even if one fails
- Provides detailed error messages (e.g., S3 connection failures, DB errors)

## Clean  (`./clean`)

Processes the `S3DeletionQueue` to remove orphaned images from S3 and local storage.

### Usage

```bash
# Normal mode - delete queued images
./clean

# Dry run - show what would be deleted without actually deleting
./clean --dry-run
```

### What it does

1. Fetches pending deletions from `S3DeletionQueue` table
2. For each queued item:
   - Deletes from S3 (if `IMAGE_STORAGE=s3` or `IMAGE_STORAGE=both`)
   - Deletes from local storage (if `IMAGE_STORAGE=local` or `IMAGE_STORAGE=both`)
   - Removes item from queue on success

### How items get queued

Images are automatically queued for deletion via database triggers:

**Artist deletion trigger:**
```sql
CREATE TRIGGER trigger_queue_artist_image_deletion
BEFORE DELETE ON "Artist"
FOR EACH ROW
EXECUTE FUNCTION queue_artist_image_deletion();
```

**Release deletion trigger:**
```sql
CREATE TRIGGER trigger_queue_release_image_deletion
BEFORE DELETE ON "LocalRelease"
FOR EACH ROW
EXECUTE FUNCTION queue_release_image_deletion();
```

These triggers fire when:
- Individual artists/releases are deleted
- The `./nuke` script truncates tables (bulk deletion)
- Foreign key cascades delete related records

### CLI Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be deleted without actually deleting |

### Error Handling

- Errors are logged to `errors.log` with `[CLEAN]` prefix
- Non-fatal: continues with next item even if one fails
- Failed deletions remain in queue for retry on next run

### Automation

For production, we can run the clean script periodically via cron:

```bash
# Add to crontab (run every 6 hours)
0 */6 * * * cd /path/to/DMPv6 && ./clean >> logs/clean.log 2>&1
```
