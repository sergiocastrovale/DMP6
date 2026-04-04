# DMP v6

Personal music library web app. Scans local audio files, matches against MusicBrainz, provides browsing/playback/discovery/analytics.

## Stack

- **Web**: Nuxt 4 + Vue 3 + TypeScript + Tailwind v4 + Pinia + Prisma + PostgreSQL
- **Scripts**: Rust CLI tools (`sync`, `analysis`, `clean`, `nuke`, `audit`)
- **Deployment**: Docker on TrueNAS NAS via `web/deploy.sh`
- **Optional**: Redis cache (ioredis), S3 image storage, Cloudflare Tunnel

## Project Layout

```
web/                          # Nuxt app
  nuxt.config.ts
  prisma/schema.prisma        # DB schema (source of truth)
  server/
    api/                      # ~35 API endpoints
    middleware/auth.ts         # Session-based auth (in-memory, single-user)
    middleware/images.ts       # Serves /img/* with cache headers
    utils/prisma.ts            # Singleton PrismaClient
    utils/redis.ts             # Optional Redis, graceful fallback
    utils/cache.ts             # cachedResponse() / invalidateCache()
    utils/auth.ts              # createSession / validateSession
    utils/explore.ts           # 4-slider track scoring algorithm
  stores/
    player.ts                  # Audio playback, queue, shuffle modes, explorer
    browse.ts                  # Artist grid with filters/pagination
    terminal.ts                # In-app terminal for running scripts
  composables/
    useImageUrl.ts             # Resolves S3 vs local image paths
    useAuth.ts                 # Login/logout
  components/                  # ~45 Vue components (see below)
  pages/                       # 11 routes (see below)
  types/                       # All TypeScript interfaces
  helpers/constants.ts         # Statuses, link icons, limits
scripts/
  sync/src/main.rs             # Index local files + MusicBrainz sync (~5000 lines)
  analysis/src/main.rs         # Metadata quality scanner, HTML reports
  clean/src/main.rs            # Process S3DeletionQueue
  nuke/src/main.rs             # DB reset (full or local-only)
  audit/src/main.rs            # Data integrity → XLSX
docker-compose.yml             # 3 services: dmp-web, dmp-redis, dmp-cloudflared
web/Dockerfile                 # Multi-stage Node 20 build
web/deploy.sh                  # Build → SCP → docker load → restart
```

## Data Model

Dual tree linked by match IDs:

```
MusicBrainz tree (canonical):
  Artist ←→ MusicBrainzReleaseArtist ←→ MusicBrainzRelease → MusicBrainzReleaseTrack

Local tree (files on disk):
  Artist ←→ LocalReleaseArtist ←→ LocalRelease → LocalReleaseTrack

Link: LocalRelease.releaseId → MusicBrainzRelease.id
Link: LocalReleaseTrack.mbTrackId → MusicBrainzReleaseTrack.id
```

- Both artist relationships are many-to-many (via junction tables)
- No compound artists — collaborations split into individual artists, all linked to shared releases
- `ReleaseStatus`: COMPLETE | INCOMPLETE | EXTRA_TRACKS | MISSING | UNSYNCABLE | UNKNOWN
- `TrackArtistRole`: PRIMARY | ALBUM_ARTIST | FEATURED
- Releases deduplicated by `groupKey` (unique): `"mb:{mbAlbumId}"` or `"meta:{slugTitle}:{year}:{slugArtist}"`

## Key Conventions

- **Zero custom CSS** — Tailwind utility classes only, no exceptions
- **Icons**: `lucide-vue-next` only
- **Prisma singleton**: `web/server/utils/prisma.ts` — the only place to instantiate PrismaClient
- **Images**: Always use `useImageUrl()` composable to resolve artist/release images
- **Types**: All TypeScript definitions in `web/types/`
- **No scripts code in web app** — scripts are separate Rust binaries
- **Metadata is source of truth** — never use filesystem paths/folder names for artist, album, year
- **MusicBrainz IDs are definitive** — when embedded MB IDs exist in tags, use them directly without re-verification

## Dev Commands

```bash
cd web && pnpm dev              # Dev server (localhost:3000)
cd web && pnpm db:push          # Apply schema changes (no migrations, just push)
cd web && pnpm db:studio        # Prisma Studio GUI
cd web && pnpm backup           # Dump DB to web/dump/
cd web && pnpm restore          # Restore latest dump
```

## Scripts

Shell wrappers at project root. Each uses a pre-built release binary — **rebuild after code changes**:

```bash
cd scripts/sync && cargo build --release    # Must rebuild manually!
```

```bash
./sync                        # Full index + MB sync
./sync --only "Artist Name"   # Single artist
./sync --only "Name" --overwrite  # Re-sync from scratch
./sync --resume               # Continue from last checkpoint
./sync --clean                # Remove orphaned artists, then exit
./sync --verbose              # Show skipped MB releases
./analysis                    # Metadata quality HTML report → reports/
./clean                       # Process S3 deletion queue
./clean --dry-run             # Preview deletions
./nuke                        # Full DB reset + image deletion
./nuke --local-only           # Keep MB catalogue, reset local data
```

## Sync Script Architecture

The sync script (`scripts/sync/src/main.rs`) is the largest codebase component. Key phases:

### 1. Index Phase
- Walk artist folders, find audio files (.mp3/.m4a/.opus/.aac/.ogg/.flac)
- Extract metadata in parallel (rayon + lofty)
- Change detection: skip unchanged files (mtime + size + MD5 hash)
- Batch upsert LocalReleaseTrack, create Artist/LocalRelease/TrackArtist records
- Extract cover art (embedded → folder image)

### 2. MB Sync Phase
- Artist matching: 6-step fallback (embedded MB ID → name search → album search → compound split)
- Fetch artist details, genres, URLs, release groups
- Filter release groups: skip Single/Bootleg/Demo/Interview/Broadcast types
- For each group: fetch official releases only (skip Bootleg/Promotional status)
- Match local releases to MB by normalized title
- Compute match status and score

### 3. Cleanup Phase
- Split compound artists (e.g. "Band1 vs Band2")
- Remove orphaned artists (zero local tracks)
- Update statistics

### Key matching functions
- `names_are_similar()` — normalized Jaccard similarity >= 0.5, noise word filtering
- `normalize_title()` — lowercase, strip non-alphanumeric, collapse spaces
- `split_artists()` — parse multi-artist tags by delimiters and "feat." markers
- `should_skip_release()` — filter by release group type
- `check_release_status()` — compare local vs MB track lists

### Rate limiting
- MusicBrainz API: adaptive backoff 1s–10s, doubles on 429/503, reduces 15% on success

## Post-Sync Bulk Scan Routine

When syncing the full collection in batches (e.g. letter ranges: `--from=a --to=bz`), run this routine after each batch to catch and fix errors:

### Phase 1: Error Analysis
```bash
# After sync completes:
# I will check errors.log and present findings by category (encoding, corrupt MPEG, missing tags, etc.)
# You review and approve fixes.
```

### Phase 2: Fix Errors
I will fix files using:
- **Invalid encoding**: Strip + rewrite as ID3v2.4 UTF-8 with mutagen
- **Invalid item size / corrupt MPEG**: ffmpeg lossless remux
- **Bad tags**: Read TXXX:ARTISTS / TXXX:ALBUM_ARTISTS and copy to TPE1/TPE2
- **Truly corrupt**: Flag for deletion/re-download

Then resync all affected artists:
```bash
./sync --only="Artist1;Artist2;Artist3" --overwrite
```

### Phase 3: Ampersand Artist Analysis
```bash
python3 scripts/check_ampersand_artists.py
# → separator_analysis.log
```

I will present findings:
- **MULTIPLE**: Confirmed separate artists (multiple MB IDs or `;` in sort names) → fix with mutagen
- **LIKELY_MULTIPLE**: Needs MB research → I'll investigate and report
- **SINGLE**: Legitimate band names with `&` → no action

### Phase 4: Fix Ampersand Artists
For confirmed MULTIPLE artists, I replace ` & ` with `\\` in TPE2 (album artist) tag across all MP3s in the folder using mutagen.

Then resync:
```bash
./sync --only="ArtistName;AnotherBand" --overwrite
```

### Phase 5: Verify & Loop
Repeat until errors.log is clean.

### How to Request

Say one of these when you've finished a batch sync:

- **"run the routine"** — start from Phase 1 (full analysis → fixes → verification)
- **"check errors"** — start Phase 1 only (analyze + present findings)
- **"fix the errors"** — skip to Phase 2 (apply fixes + resync)
- **"check ampersand"** — run Phase 3 (analysis of separator_analysis.log)
- **"fix ampersand"** — skip to Phase 4 (split tags + resync)

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
| `/login` | Auth page |

## Component Organization

```
components/
  layout/          # Logo, SearchBar, SearchDropdown, Sidebar, MobileNav
  browse/          # FilterLetter, FilterSort, FilterGenre, FilterScore, ArtistCard, ArtistGrid
  artist/          # ArtistHeader, ArtistReleases, Cover, Initial, Genres, Links, TotalPlays, etc.
  release/         # ReleaseCover, StatusBadge, TracksTable
  home/            # ReleaseGrid, PlaylistGrid
  player/          # AudioPlayer
  terminal/        # Output
  ui/              # Skeleton, ReleaseSkeleton
  # Root-level: TrackList, Dialog, Dropdown, ButtonDropdown, Popover, Slider, Switch, ToggleFavorite
```

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

## Deployment

```bash
web/deploy.sh              # Build + transfer + restart (full)
web/deploy.sh web           # Web image only
web/deploy.sh scripts       # Scripts image only
web/deploy.sh build         # Build locally, no transfer
web/deploy.sh push          # Transfer pre-built images
web/deploy.sh deploy        # Copy docker-compose.yml + restart
```

NAS target: TrueNAS at `192.168.1.241`, data at `/mnt/SSD/web/dmp/`, music at `/mnt/dmp/music/mainstream`.

## Environment Variables

Essential: `MUSIC_DIR`, `DATABASE_URL`, `PROJECT_ROOT`
Optional: `REDIS_URL`, `IMAGE_STORAGE` (local/s3/both), `FANART_API_KEY`
Deployment: `SERVER_HOST`, `SERVER_USER`, `DEPLOY_PATH`, `SSH_KEY_PATH`, `ADMIN_USER`, `ADMIN_PASSWORD`
S3: `S3_IMAGE_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_PUBLIC_URL`

See `web/.env.example` for full documentation.
