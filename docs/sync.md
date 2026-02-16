# Scripts

## Prerequisites

- **Rust** (stable toolchain): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **PostgreSQL 16+**
- **Node.js 20+** and **pnpm** (for Prisma): `npm install -g pnpm`

## PostgreSQL Setup (WSL2 / Ubuntu)

### Install

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
```

### Start the service

```bash
sudo service postgresql start
```

### Create database and user

```bash
sudo -u postgres psql <<SQL
CREATE USER dmp6 WITH PASSWORD 'dmp6';
CREATE DATABASE dmp6 OWNER dmp6;
GRANT ALL PRIVILEGES ON DATABASE dmp6 TO dmp6;
SQL
```

### Verify connection

```bash
psql -U dmp6 -d dmp6 -h localhost -c "SELECT 1;"
```

## Environment Configuration

All scripts read configuration from `web/.env`:

```env
# Music Directory
MUSIC_DIR=/path/to/your/music/library

# PostgreSQL Database Connection
DATABASE_URL=postgresql://dmp6:dmp6@localhost:5432/dmp6

# Image Storage Configuration
# Options: local, s3, or both
IMAGE_STORAGE=local

# S3 Configuration (required if IMAGE_STORAGE is s3 or both)
S3_BUCKET=
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA
S3_SECRET_ACCESS_KEY=
S3_ENDPOINT=

# Public URL for accessing S3 images
S3_PUBLIC_URL=

# Remote server settings (for deployment, if applicable)
SERVER_HOST=
SERVER_USER=
DEPLOY_PATH=/var/www/dmp

# Prevent Playlists, Favorites and Settings from being available online (optional)
# MANAGED=false

# Soulseek / slsk-batchdl settings (optional)
SLSK_USERNAME=
SLSK_PASSWORD=
SLSK_PATH=/path/to/sldl
SLSK_DOWNLOAD_DIR=/path/to/downloads
SLSK_ALLOWED_FORMATS=flac,mp3
SLSK_MIN_BITRATE=320
SLSK_NAME_FORMAT="{artist}/{year} - {album}/{track}. {title}"
SLSK_SEARCH_TIMEOUT=15
```

## Database Schema

The Prisma schema at `web/prisma/schema.prisma` is the source of truth. Install dependencies and push the schema:

```bash
cd web && pnpm install && pnpm prisma db push && cd ..
```

This creates all tables and relations automatically. Run this whenever the schema changes.

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

## Typical Workflow

```bash
# 1. Set up database (once)
sudo service postgresql start
cd web && pnpm install && pnpm prisma db push

# 2. Index your library
./index

# 3. Sync with MusicBrainz
./sync

# 4. Re-index after adding new music
./index --resume    # or ./index for full scan

# 5. Sync new/updated artists (auto-detects who needs syncing)
./sync

# 6. Clean up orphaned images (optional)
./clean

# 7. Start over from scratch (DANGER: deletes all data)
./nuke
```

## Nuke Script (`./nuke`)

Completely deletes all database tables and image files. **Destructive operation** - use with caution!

### Usage

```bash
./nuke
```

### What it does

1. **Truncates all database tables** (in correct dependency order):
   - `PlaylistTrack`
   - `Playlist`
   - `TrackArtist`
   - `FavoriteTrack`
   - `FavoriteRelease`
   - `LocalReleaseTrack`
   - `LocalRelease`
   - `MusicBrainzReleaseTrack`
   - `MusicBrainzRelease`
   - `ArtistUrl`
   - `Artist`
   - `Genre`
   - `ReleaseType`
   - `IndexCheckpoint`
   - `S3DeletionQueue`
   - `Statistics`

2. **Deletes local image files**:
   - `web/public/img/releases/*.jpg`
   - `web/public/img/artists/*.jpg`

3. **Deletes S3 images** (if `IMAGE_STORAGE=s3` or `IMAGE_STORAGE=both`):
   - All objects in `releases/` prefix
   - All objects in `artists/` prefix

### CLI Output

The nuke script provides real-time progress with colored output:
- **Blue**: Operation start
- **Green**: Successful deletions
- **Yellow**: Warnings (e.g., no images found)
- **Red**: Errors
- **Cyan**: Summary statistics

### Error Handling

- Errors are logged to `errors.log` with `[NUKE]` prefix
- Non-fatal: continues with next operation even if one fails
- Provides detailed error messages (e.g., S3 connection failures, DB errors)

## Clean Script (`./clean`)

Processes the `S3DeletionQueue` to remove orphaned images from S3 and local storage.

### Usage

```bash
# Normal mode - delete queued images
./clean

# Dry run - show what would be deleted without actually deleting
./clean --dry-run
```

### What it does

1. **Fetches pending deletions** from `S3DeletionQueue` table
2. **For each queued item**:
   - Deletes from S3 (if `IMAGE_STORAGE=s3` or `IMAGE_STORAGE=both`)
   - Deletes from local storage (if `IMAGE_STORAGE=local` or `IMAGE_STORAGE=both`)
   - Removes item from queue on success
3. **Provides summary** of deleted/failed counts

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

### CLI Output

The clean script provides real-time progress:
- **Blue**: Processing start
- **Green**: Successful deletions
- **Yellow**: Warnings (e.g., file not found)
- **Red**: Errors
- **Cyan**: Summary statistics

### Error Handling

- Errors are logged to `errors.log` with `[CLEAN]` prefix
- Non-fatal: continues with next item even if one fails
- Failed deletions remain in queue for retry on next run

### Automation

For production, run the clean script periodically via cron:

```bash
# Add to crontab (run every 6 hours)
0 */6 * * * cd /path/to/DMPv6 && ./clean >> logs/clean.log 2>&1
```

Or run manually after bulk operations:

```bash
./nuke  # Deletes everything
./clean # Cleans up S3/local orphans
```

## Troubleshooting

### "Failed to connect to database"

- Is PostgreSQL running? `sudo service postgresql start`
- Check `DATABASE_URL` in `web/.env`
- Test connection: `psql -U dmp6 -d dmp6 -h localhost`

### "MUSIC_DIR not set"

- Set `MUSIC_DIR` in `web/.env` or pass as argument: `./index /path/to/music`

### Indexer seems slow

- Check `--threads` (defaults to all cores)
- First run is slowest; subsequent runs use change detection
- Use `--limit N` to test with fewer files

### Rate limiting during sync

**This is NORMAL and EXPECTED for large libraries.** The sync script is designed to handle 2+ million files.

**How it works**:
- Starts conservatively at 1 second per request
- On success, gradually speeds up to 1 second minimum
- On rate limit (503/429), exponentially backs off: 1s → 2s → 4s → 8s → 16s → 32s → 60s (max)
- Retries each failed request up to 10 times with exponential backoff
- Only gives up on a release after ~3+ minutes of retries

**What the errors mean**:
- **503 errors**: MusicBrainz servers are temporarily busy (not your fault)
- **429 errors**: Rate limit exceeded (requests too fast)

**What to do**:
- **Nothing!** Just let it run. The script will automatically throttle and retry.
- For massive libraries, sync will take hours or even days - this is expected
- The script continues where it left off - if interrupted, just run `./sync` again
- Artists without `musicbrainzId` or with `lastSyncedAt` older than 30 days will be retried

**Batching for faster progress** (optional):
- Run multiple sync processes with different database connections
- Sync during off-peak hours (MusicBrainz is busier during US/EU daytime)
- Sync during off-peak hours (MusicBrainz is busier during US/EU daytime)

### "pnpm prisma db push" fails

- Ensure Node.js and pnpm are installed: `npm install -g pnpm`
- Run `cd web && pnpm install` first (installs Prisma v6 LTS)
- Check `DATABASE_URL` format: `postgresql://user:password@host:port/database`

### Stale checkpoint

- If the indexer seems to skip files it shouldn't, clear the checkpoint:
  ```bash
  psql -U dmp6 -d dmp6 -c 'DELETE FROM "IndexCheckpoint";'
  ```
- Or run without `--resume`

## File Locations

| What | Path |
|------|------|
| Indexer binary | `scripts/index/target/release/dmp-index` |
| Sync binary | `scripts/sync/target/release/dmp-sync` |
| Prisma schema | `web/prisma/schema.prisma` |
| Environment | `web/.env` |
| Cover art (releases) | `web/public/img/releases/` |
| Artist images | `web/public/img/artists/` |
| Error log | `errors.log` (project root) |
