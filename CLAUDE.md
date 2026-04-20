# DMP v6

Personal music library web app. Scans local audio files, matches against MusicBrainz, provides browsing/playback/discovery/analytics.

## Stack

- **Web**: Nuxt 4 + Vue 3 + TypeScript + Tailwind v4 + Pinia + Prisma + PostgreSQL
- **Scripts**: Rust CLI tools (`sync`, `analysis`, `nuke`, `audit`, `fix`)
- **Deployment**: Docker on TrueNAS NAS via `./deploy.sh`
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
  nuke/src/main.rs             # DB reset (full wipe)
  audit/src/main.rs            # Issue detection → DB (IssueCorruptedTpe2, IssueUnsplitArtist, etc.)
  fix/src/main.rs          # Issue remediation → tag writes + DB ops
  playlists/src/main.rs  # Auto-generate genre playlists
docker-compose.yml             # 3 services: dmp-web, dmp-redis, dmp-cloudflared
web/Dockerfile                 # Multi-stage Node 20 build
./deploy.sh                  # Build → SCP → docker load → restart
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
- `PlaylistType`: MANUAL | GENRE
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
cd scripts && cargo build --release    # Must rebuild manually!
```

```bash
./index                       # Index local files (extract metadata, upsert to DB)
./sync                        # MusicBrainz sync (artists where lastIndexedAt > lastSyncedAt)
./index && ./sync             # Full workflow
./index --only "Artist Name"  # Index single artist
./sync --only "Artist Name"   # Sync single artist
./index --only "Name" --overwrite  # Force re-index
./sync --only "Name" --overwrite   # Force re-sync
./index --resume              # Continue from last checkpoint
./index --quick               # Skip unchanged folders (mtime check)
./sync --verbose              # Show skipped MB releases
./audit                       # Detect metadata issues → write to DB (all types)
./audit --corrupted           # Only detect corrupted TPE2 tags
./audit --unsplit             # Only detect unsplit compound artists
./audit --orphans             # Only detect orphan artists
./audit --duplicates          # Only detect duplicate artists
./audit --missing             # Only detect missing metadata fields
./audit --enrichment          # Only detect enrichment gaps (BPM, mood, AcousticID, MB links, Discogs, Bandcamp, Wikipedia)
./fix --corrupted             # Apply PENDING corrupted TPE2 fixes (tag writes)
./fix --unsplit               # Apply PENDING unsplit artist fixes (albumArtist → primary, artist → compound)
./fix --orphans               # Apply PENDING orphan artist fixes (delete from DB)
./fix --duplicates            # Apply PENDING duplicate artist fixes (merge B into A)
./fix --missing               # Apply PENDING missing metadata fixes (tag writes)
./refresh                # ./index && ./sync with same args
./refresh --only="Name"  # Refresh specific artist
./analysis                    # Metadata quality HTML report → reports/
./nuke                        # Full DB reset + image deletion
./nuke --keep-artist-img      # Full reset but preserve artist images
./nuke --only="Artist Name"   # Delete one artist + cascade ghost co-artists
./nuke --only="Name" --dry-run  # Preview what --only would delete
./playlists      # Generate/update genre playlists
./playlists --dry-run  # Preview without changes
./playlists --report   # Show genre → group assignments
./playlists --group rock # Update single group
```

### Running on NAS (Docker)

SSH into the NAS and run as single-line commands (zsh on TrueNAS doesn't handle multiline):

```bash
docker run --rm --env-file /mnt/SSD/web/dmp/.env --add-host=host.docker.internal:host-gateway -e PROJECT_ROOT=/app -e MUSIC_DIR=/music -v /mnt/dmp/music/mainstream:/music:ro -v /mnt/SSD/web/dmp/img:/app/web/public/img dmp-scripts:latest index --from=e --to=fz
```

Run the same with `sync --from=e --to=fz` for the MB sync step.

### Fixing Wrong Artist Pages

When browsing reveals artists with bad names (track numbers, paths, garbage):

1. **Detect**: `./audit` — writes issues to DB
2. **Review**: `/issues` in the web UI — inspect and queue fixes
3. **Fix**: `./fix --corrupted` / `./fix --unsplit` / `./fix --orphans` etc.
4. **Refresh**: `./refresh --only="..."` for file-writing fix types
5. **Iterate**: Re-run audit until clean

## Script Architecture

See [`docs/scripts/sync.md`](docs/scripts/sync.md) for full documentation. Key points:

- **index**: walk folders (jwalk), extract metadata (rayon + lofty), batch upsert, sets `lastIndexedAt`
- **sync**: queries artists where `lastIndexedAt > lastSyncedAt`, 6-step MB matching, rate-limited API
- **Cleanup**: orphan artists + empty releases deleted automatically during `./index` and `./sync` runs
- **Rate limiting**: MusicBrainz API adaptive backoff 250ms-10s
- **Key functions**: `names_are_similar()` (Jaccard ≥ 0.5), `normalize_title()`, `split_artists()`

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
./deploy.sh              # Build + transfer + restart (full)
./deploy.sh web           # Web image only
./deploy.sh scripts       # Scripts image only
./deploy.sh build         # Build locally, no transfer
./deploy.sh push          # Transfer pre-built images
./deploy.sh deploy        # Copy docker-compose.yml + restart
```

NAS target: TrueNAS at `192.168.1.241`, data at `/mnt/SSD/web/dmp/`, music at `/mnt/dmp/music/mainstream`.

## Environment Variables

Essential: `MUSIC_DIR`, `DATABASE_URL`, `PROJECT_ROOT`
Optional: `REDIS_URL`, `IMAGE_STORAGE` (local/s3/both), `FANART_API_KEY`
Deployment: `SERVER_HOST`, `SERVER_USER`, `DEPLOY_PATH`, `SSH_KEY_PATH`, `ADMIN_USER`, `ADMIN_PASSWORD`
S3: `S3_IMAGE_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_PUBLIC_URL`

See `web/.env.example` for full documentation.
