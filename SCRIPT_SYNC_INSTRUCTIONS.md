# Sync Scripts

## Overview

Two Rust CLI tools that index a local music library and reconcile it against the MusicBrainz catalogue.

| Script | Command | Purpose |
|--------|---------|---------|
| Indexer | `./index` | Scan audio files, extract metadata, build local catalogue in PostgreSQL |
| Sync | `./sync` | Fetch MusicBrainz data, match releases, download artist images |

Built with Rust for maximum performance (~2M files). Follows the same patterns as the analysis script (see docs/analysis.md).

## Reference documents

- `docs/PRD.md` - Product requirements
- `docs/scripts.md` - How v5 scripts worked (Node.js)
- `docs/schema.md` - v5 database schema (reference only)
- `docs/analysis.md` - Existing Rust analysis tool (patterns to follow)
- `docs/sync.md` - Setup instructions and CLI reference (generated)

## Decisions

### Database

- **Engine**: PostgreSQL (not MySQL as in v5)
- **Schema management**: Prisma is the source of truth. The Rust scripts call `npx prisma db push` to create/update tables.
- **IDs**: CUIDs generated via `cuid2` crate (Prisma-compatible)
- **Connection**: Read `DATABASE_URL` from `web/.env`

### Architecture

- Two **separate** Cargo projects: `scripts/index/` and `scripts/sync/`
- Wrapper scripts at project root: `./index` and `./sync`
- Config read from `web/.env` (MUSIC_DIR, DATABASE_URL)
- MUSIC_DIR can be overridden via CLI argument

### Schema (v6, new)

Key changes from v5:
- `LocalReleaseTrack.metadata` - JSONB field storing all text metadata (except title, artist, year, mbId which have their own columns)
- `LocalRelease.forcedComplete` - Boolean for status override ("Mark as complete" in UI)
- `Artist.needsMbSync` - Boolean flag for sync script
- `MusicBrainzReleaseTrack` - New table storing individual tracks from MB releases (for INCOMPLETE/EXTRA_TRACKS display)
- `IndexCheckpoint` - New table for resume functionality

### Artist identity

Artists are identified by **slug** (slugified name: lowercase, hyphens, strip special chars). Two tracks with "Radiohead" and "radiohead" share the same artist.

### LocalRelease grouping

Tracks are grouped into LocalRelease records by **artist slug + album name**. This avoids year mismatches in metadata while keeping different artists' same-named albums separate.

### TrackArtist roles

- `PRIMARY`: The track artist (from the "artist" tag)
- `ALBUM_ARTIST`: The album artist (if different from track artist)

This enables compilations to appear in an artist's catalogue.

## Script 1: Indexer (`./index`)

### What it does

1. Walks `MUSIC_DIR` recursively for audio files (mp3, flac, aac, opus, m4a, ogg)
2. Extracts metadata using `lofty` crate
3. Creates/updates Artist, LocalRelease, LocalReleaseTrack, TrackArtist records
4. Extracts embedded cover art, resizes to 200x200 JPEG, saves to `web/public/img/releases/`
5. Stores ALL text metadata in a JSONB `metadata` field on LocalReleaseTrack

### Change detection

1. **mtime + fileSize**: Fast check. If both match existing record, skip the file.
2. **contentHash**: If mtime/size changed, extract metadata, compute `md5(artist|albumArtist|album|title|year|trackNumber|discNumber|genre)` lowercased. If hash matches, update mtime only. If different, full update.

### CLI arguments

| Flag | Default | Description |
|------|---------|-------------|
| `MUSIC_DIR` (positional, optional) | from .env | Override MUSIC_DIR |
| `--overwrite` | false | Nuke matching data, then re-index from scratch |
| `--from PREFIX` | | Folders starting from prefix (case insensitive) |
| `--to PREFIX` | | Folders up to prefix (case insensitive) |
| `--only PREFIX` | | Folders starting with prefix (case insensitive) |
| `--resume` | false | Continue from last checkpoint |
| `--skip-images` | false | Skip cover art extraction |
| `--threads N` | all cores | Number of parallel workers |
| `--limit N` | 0 | Limit to first N files |

### Overwrite mode

1. Find all artists matching filters
2. Delete all their data (cascade: tracks, releases, TrackArtist, ArtistUrl, images)
3. Re-index matching folders from scratch

### Checkpoint/resume

- Stored in `IndexCheckpoint` table: last processed folder path, files processed count, timestamp
- On `--resume`: skip folders already processed (alphabetical order)
- Checkpoint saved every 100 files

### Error handling

- Files with missing critical metadata (no artist tag, etc.) are skipped and logged to `errors.log`
- Each track committed individually (one failure doesn't affect others)
- Errors don't stop the indexing process

### Cover art

- Extracted from first track of each LocalRelease that has embedded art
- Resized to 200x200 JPEG
- Saved to `web/public/img/releases/{slug}.jpg`
- Skippable with `--skip-images`

### Parallelism

- Full rayon (all CPU cores) for file reading by default
- Batch DB writes
- Configurable with `--threads`

## Script 2: MusicBrainz Sync (`./sync`)

### What it does

For each Artist where `needsMbSync = true` (or all with `--overwrite`):

1. Search MusicBrainz for artist using name (or mbId if already known)
2. Fetch complete discography (release groups)
3. Filter releases: skip Singles, Bootlegs, Demos, Unofficial, Interviews, Broadcasts
4. Create/update MusicBrainzRelease records with MB data
5. Create MusicBrainzReleaseTrack records for each track
6. Store genres/tags from MB into Genre table
7. Store artist URLs (official site, social media, etc.) into ArtistUrl
8. Download artist image: try Wikipedia first (via MB relations), then Fanart.tv. Resize to 200x200 JPEG, save to `web/public/img/artists/{slug}.jpg`
9. Status check - compare local catalogue against MB catalogue per release:
   - `COMPLETE`: All MB tracks found locally
   - `INCOMPLETE`: Some MB tracks missing (store missing track names in JSONB)
   - `EXTRA_TRACKS`: More local tracks than MB (store extra track names)
   - `MISSING`: MB release not in local catalogue
   - `UNSYNCABLE`: No MB ID on local release
   - `UNKNOWN`: Has MB ID but not found online
10. Calculate `averageMatchScore` per artist
11. Set `needsMbSync = false` and `lastSyncedAt = now()`

### Status check override

`LocalRelease.forcedComplete` boolean. When true, the UI shows `FORCED_COMPLETE` regardless of actual status. Togglable via a "Mark as complete" button.

### Match score

`averageMatchScore` on Artist = percentage of MB catalogue owned locally (float, 0.0 to 1.0):
- COMPLETE: 1.0
- INCOMPLETE: proportion of tracks present (e.g., 8/10 = 0.8)
- EXTRA_TRACKS: 1.0
- MISSING: 0.0
- UNSYNCABLE: 0.0
- UNKNOWN: 0.0

### CLI arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--overwrite` | false | Re-sync all artists (ignore needsMbSync flag) |
| `--from PREFIX` | | Artists starting from prefix |
| `--to PREFIX` | | Artists up to prefix |
| `--only PREFIX` | | Artists starting with prefix |

### Rate limiting

Adaptive strategy:
- Start with minimal delay (100ms)
- On 503 response: back off to 1.5s, retry up to 3 times
- On success after backoff: gradually reduce delay
- Never go below 100ms between requests

### Release types

Stored exactly as MusicBrainz returns them. Skipped: Singles, Bootlegs, Demos, Unofficial releases, Interviews, Broadcasts.

## Catalogues

### Local catalogue

The local audio files' metadata is the source of truth at all times.

We won't modify or care about the status of this metadata: Beets (an external tool not related to our implementation) will be handling it.

Metadata is saved to the DB in two ways:
- title, artist, year and MusicBrainz ID as regular DB fields in LocalRelease and LocalReleaseTrack
- A JSONB `metadata` field holds ALL text metadata, except title, artist, year and MusicBrainz ID

### MusicBrainz catalogue

After the indexer runs, the sync script fetches the full artist catalogue from MusicBrainz and reconciles it against the local catalogue. After this point, we have a local collection fully reconciled with the "official" catalogues.
