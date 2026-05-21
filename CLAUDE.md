# DMP v6

Personal music library web app. Scans local audio files, matches against MusicBrainz, provides browsing/playback/discovery/analytics.

## Stack

- **Web**: Nuxt 4 + Vue 3 + TypeScript + Tailwind v4 + Pinia + Prisma + PostgreSQL
- **Scripts**: Rust CLI tools (`sync`, `analysis`, `nuke`, `audit`, `fix`)
- **Deployment**: Docker on TrueNAS NAS via `./deploy`
- **Optional**: Redis cache (ioredis), S3 image storage, Cloudflare Tunnel

## Data Model

Dual tree linked by match IDs:

```
MusicBrainz tree (canonical):
  Artist ←→ MusicBrainzReleaseArtist ←→ MusicBrainzRelease → MusicBrainzReleaseTrack

Local tree (files on disk):
  Artist ←→ LocalReleaseArtist ←→ LocalRelease → LocalReleaseTrack
  Artist ←→ TrackRelatedArtist ←→ LocalReleaseTrack

Link: LocalRelease.releaseId → MusicBrainzRelease.id
Link: LocalReleaseTrack.mbTrackId → MusicBrainzReleaseTrack.id
```

- `LocalReleaseArtist` = main artists (albumArtist tag owners), many-to-many
- `TrackRelatedArtist` = related/guest artists (artist tag extras not in albumArtist), many-to-many
- `Artist.relatedOnly` = true for guests (no own browse page, no MB sync); flips to false when found as albumArtist
- `ReleaseStatus`: COMPLETE | INCOMPLETE | EXTRA_TRACKS | MISSING | UNKNOWN | UNMATCHED
- `PlaylistType`: MANUAL | GENRE
- Releases deduplicated by `groupKey` (unique): `"mb:{mbAlbumId}"` or `"meta:{slugTitle}:{year}:{slugArtist}"`

## Standards

### Coding standards

- Never write comments in HTML
- Prefer arrow functions in every context
- Always wrap statements around {}: 

```javascript
# WRONG
if (a) return b

# CORRECT
if (a) {
  return b
}
```

- Boyscout rule: if you find any wrong conventions as you go through the files, apply the correct ones (e.g. one-line if statements)
- Split big Vue contexts into modular components; prefer slim pages with many imported components
- Add meaningful constants in helpers/constants.ts
- Add multi-purpose functions in helpers/functions.ts
- Prefer ternary operators:

```javascript
# WRONG
if (a) {
  return b
}

return c

# CORRECT
return a ? b : c
```

- In Vue files, always organize the script code by context: 1. composables 2. static variables 3. watchers 4. computed 5. refs 5. methods
- Zero custom CSS: Tailwind utility classes only, no exceptions
- Icons: `lucide-vue-next` only
- Prisma singleton: `web/server/utils/prisma.ts` is the only place to instantiate PrismaClient

### Project conventions

- **Images**: Always use `useImageUrl()` composable to resolve artist/release images
- **Types**: All TypeScript definitions in `web/types/`
- **No scripts code in web app** — scripts are separate Rust binaries located in /scripts
- **Metadata is source of truth** — never use filesystem paths/folder names for artist, album, year or any other information
- **MusicBrainz IDs are definitive** — when embedded MB IDs exist in tags, use them directly without re-verification

## Scripts

Shell wrappers at project root. Each uses a pre-built release binary — **rebuild after code changes**:

```bash
cd scripts && cargo build --release    # Must rebuild manually!
```

```bash
# Index & Sync
./index                       # Index local files (extract metadata, upsert to DB)
./sync                        # MusicBrainz sync (artists where lastIndexedAt > lastSyncedAt)
./index && ./sync             # Full workflow
./refresh                     # Shorthand: ./index && ./sync with same args
./refresh --only "Name"       # Refresh specific artist
./refresh --release "clxxx"   # Refresh single release (re-index + re-sync)
./index --only "Name"         # Index single artist (prefix match)
./index --only "Name" --exact # Index exact artist (no prefix matching)
./index --only "Name" --overwrite  # Force re-index (keeps existing covers)
./index --only "Name" --overwrite-with-images  # Force re-index + re-extract covers
./index --resume              # Continue from last checkpoint
./index --inspect             # Re-check existing files for metadata changes
./index --folders "Artist/Album"   # Re-index exact folder paths
./index --release "clxxx"     # Re-index single release by LocalRelease ID
./index --delete              # Delete local data for matched artists
./sync --only "Name" --exact  # Sync exact artist
./sync --only "Name" --overwrite   # Force re-sync
./sync --release "clxxx"      # Re-sync single release
./sync --delete               # Delete MB data for matched artists
./sync --verbose              # Show skipped MB releases

# Audit & Fix
./audit                       # Detect metadata issues → write to DB (all types)
./audit --corrupted           # Only detect corrupted TPE2 tags
./audit --unsplit             # Only detect unsplit compound artists
./audit --orphans             # Only detect orphan artists
./audit --duplicates          # Only detect duplicate artists
./audit --missing             # Only detect missing metadata fields
./audit --enrichment          # Only detect enrichment gaps (BPM, mood, AcousticID, etc.)
./fix --corrupted             # Apply PENDING corrupted TPE2 fixes (tag writes)
./fix --unsplit               # Apply PENDING unsplit artist fixes
./fix --orphans               # Apply PENDING orphan artist fixes (delete from DB)
./fix --duplicates            # Apply PENDING duplicate artist fixes (merge B into A)
./fix --missing               # Apply PENDING missing metadata fixes (tag writes)
./fix --revert --corrupted    # Revert previously applied corrupted fixes

# Destructive
./delete "Artist Name"        # Delete artist + cascade (exact match, flip-or-delete logic)
./delete "A;B" --dry-run      # Preview multi-artist deletion
./nuke                        # Full DB reset + image deletion
./nuke --keep-artist-img      # Full reset but preserve artist images
./nuke --only "Artist Name"   # Delete one artist + cascade (always exact match)
./nuke --only "Name" --dry-run  # Preview what --only would delete

# Other
./analysis /path/to/music     # Standalone metadata quality HTML report → reports/
./playlists                   # Generate/update genre playlists
./playlists --dry-run         # Preview without changes
./playlists --report          # Show genre → group assignments
./playlists --group rock      # Update single group
```
See the docs/scripts folder for context on each script.

### Fixing Wrong Artist Pages

When browsing reveals artists with bad names (track numbers, paths, garbage):

1. **Detect**: `./audit` — writes issues to DB
2. **Review**: `/issues` in the web UI — inspect and queue fixes
3. **Fix**: `./fix --corrupted` / `./fix --unsplit` / `./fix --orphans` etc.
4. **Refresh**: `./refresh --only="..."` for file-writing fix types
5. **Iterate**: Re-run audit until clean

### Error Logs

On the NAS, script error logs are at: `docker exec dmp cat /app/errors.log`

## API Endpoints

### Core
- `GET /api/artists` — paginated list with filters (letter, genre, search, score, sort)
- `GET /api/artists/[slug]` — artist detail with genres, URLs, stats
- `GET /api/artists/[slug]/releases` — all releases (unified MB + local)
- `GET /api/artists/[slug]/tracks` — all tracks
- `GET /api/releases/[id]/tracks` — tracks in a release (merges local + MB missing)

### Playback
- `GET /api/audio/[id]` — stream audio with HTTP range support + ETag
- `POST /api/tracks/[id]/play` — increment playCount
- `POST /api/tracks/explore` — 4-slider scoring (energy/era/familiarity/sound)
- `GET /api/tracks/random-batch` — random tracks for catalogue shuffle

### Library
- `GET /api/releases/latest` — recently added
- `GET /api/releases/last-played` — recently played
- `GET /api/search` — full-text across artists/releases/tracks
- `GET /api/timeline/decades` — decade grouping
- `GET /api/genres` — all genres with counts
- `GET /api/stats` — library statistics

### CRUD
- `/api/playlists/*` — CRUD for playlists and playlist tracks
- `/api/favorites/*` — toggle favorite releases and tracks
- `/api/auth/login`, `/api/auth/logout` — session auth

### Operations
- `POST /api/terminal/run` — execute shell commands (SSE streaming)
- `GET /api/health` — health check (public)

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard: latest, recently played, playlists, favorites |
| `/browse` | Artist grid with letter/genre/score filters, infinite scroll |
| `/artist/[slug]` | Artist detail: header, releases, sync controls |
| `/explore` | 4-slider music discovery (energy/era/familiarity/sound) |
| `/playlists` | Playlist library |
| `/playlists/[slug]` | Single playlist with tracks |
| `/favorites` | Tabbed favorites (releases/tracks) |
| `/timeline` | Browse by decade/year |
| `/statistics` | Library stats dashboard |
| `/issues` | Metadata issue overview — run audit, view counts per type |
| `/issues/[type]` | Per-type issue table — select, edit proposed fixes, queue for fix |
| `/login` | Auth page |

## Player Store

The player (`stores/player.ts`) supports 5 shuffle modes:
- `off` — sequential playback
- `release` — shuffle within current release
- `artist` — shuffle within current artist
- `catalogue` — random tracks from entire library (prefetched buffer)
- `explorer` — score-based discovery using 4 sliders

State persisted to localStorage (queue capped at 200 tracks).

## Caching (Redis)

Optional Redis sidecar. Falls through to DB silently if unavailable.

| Endpoint | TTL |
|----------|-----|
| `/api/stats` | 5 min |
| `/api/genres` | 5 min |
| `/api/artists` | 2 min |
| `/api/artists/[slug]` | 10 min |
| `/api/releases/latest` | 2 min |
| `/api/releases/last-played` | 1 min |
| `/api/timeline/*` | 5 min |

Invalidated on track play (`last-played`, `stats`, `artist:{slug}`) and timeline refresh.

## NAS integration (production server)

NAS target: TrueNAS at `192.168.1.241`, data at `path/to/dmp/`, music at `/mnt/dmp/music/mainstream`.

## Deployment

```bash
./deploy  # Build + transfer + restart
```

### Running scripts

Scripts are built into the docker container and copied to the NAS folder. You can run them directly:

```bash
./index --from=e --to=fz
./sync --from=e --to=fz
```

## Environment Variables

See `web/.env.example` for full documentation.
