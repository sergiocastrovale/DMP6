# DMP v6

Personal music library web app. Scans local audio files, matches against MusicBrainz, provides browsing/playback/discovery/analytics.

## Stack

- **Web**: Nuxt 4 + Vue 3 + TypeScript + Tailwind v4 + Pinia + Prisma + PostgreSQL
- **Scripts**: Rust CLI tools, one crate per binary under `scripts/` (`index`, `sync`, `audit`, `fix`, `problems`, `analysis`, `nuke`, `delete`, `playlists`, `extract-meta-images`, `dissect`, `mosaic`, plus the shared `common` lib)
- **Mobile**: PWA, plus a Capacitor Android wrapper in `mobile/` that points at a deployed origin (`MOBILE_SERVER_URL`) — see `docs/pwa_capacitor_android.md`
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
Link: Artist.primaryArtistId → Artist.id (duplicate → canonical)
```

- `LocalReleaseArtist` = main artists (owner-tag owners), many-to-many. The **owner tag** is `albumArtist`, except when that is a Various-Artists placeholder — then the track's own `artist` tag decides, so a compilation is co-owned by its contributors. One definition (`index::resolve::owner_tag`), called by both the folder loop and the resolve pass's reconcile; when they had separate copies, VA compilations were never reconciled and kept the raw compound tag as an owner.
- `TrackRelatedArtist` = credited artists ("appears on"), many-to-many. Owning a release (`LocalReleaseArtist`) vs merely being credited is the discography/appears-on split; an artist may legitimately hold credits and own nothing. **Ownership is derived, never stored** — `EXISTS(LocalReleaseArtist)`, no flag column. Which parts of a compound tag own vs. get credited is decided by the join phrase (` with `/`feat.` ⇒ first owns, rest credited; ` & `/`,` ⇒ all co-own).
- **Artist identity is resolved against MusicBrainz, not guessed from punctuation.** A separator never splits a name on its own — `common::mb::resolve` asks MB whether the whole string is an artist first (so "Nurse With Wound" survives), then validates candidate groupings. Tiers: embedded multi-value `Artists[]`/`MusicBrainzArtistId[]` pairs (free) → `MbArtistLookup` cache → whole-string MB search → memoized span search → unverified atom fallback. Transient MB failures defer rather than guess. Only MB-verified names become credit artists. Separators need surrounding spaces except `\`, `\\` and `|` — bare `/` and `+` are deliberately not separators ("AC/DC"). `\\` is the ID3v2.3 multi-value join and must be matched before `\`. See `docs/scripts/index.md`.
- `Artist.country` = ISO 3166-1 alpha-2 code from MusicBrainz area (e.g. "US", "GB"), populated by sync
- `Artist.primaryArtistId` = FK to canonical Artist when this artist shares an MB ID with another; connected artist hidden from browse, catalogue aggregated on primary's page. Set by sync, and by `./index --canonicalize-artists` — but only when **both** names have an `MbArtistLookup` row resolving to the same MB ID. `Artist.musicbrainzId` alone is not a safe merge key: it leaks onto compounds (`"Lena Horne & Gábor Szabó"` carries Lena Horne's ID while its lookup row says MB denied the string), so merging on the column folds collaborations into their first member.
- `ReleaseStatus`: COMPLETE | INCOMPLETE | EXTRA_TRACKS | MISSING_TRACKS | MISSING | UNKNOWN | UNMATCHED
- `PlaylistType`: MANUAL | GENRE | REGION
- `LocalRelease` grouped one-per-folder: `groupKey` (unique) = `"folder:{folderPath}"` (root-level files fall back to `"meta:{slugTitle}:{year}:{slugArtist}"`). Per-track MB ids are NOT part of the key — folder is the physical release unit; sync matches folder→MB by embedded-id consensus, then a guarded title+artist search, binding only Official Album/EP (never a Single). Keying on per-track ids shredded compilations into per-track fragments — see `docs/scripts/index.md`, `docs/scripts/sync.md`.

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

- In Vue files, always organize the script code by context: 1. composables 2. static variables 3. refs 4. watchers 5. computed 6. methods
- Zero custom CSS: Tailwind utility classes only. Sanctioned exceptions (things Tailwind utilities genuinely can't express) get a `<style scoped>` block and stay documented here rather than pretending the rule is unbroken:
  - `components/playlist/Block.vue`, `pages/playlists/[slug].vue`: `@property --angle` + `@keyframes` for the animated conic-gradient genre border — CSS `@property` registration and keyframe animations have no Tailwind utility equivalent.
  - `pages/labs/map.vue`: Leaflet control overrides (`.leaflet-container`, `.leaflet-control-zoom a`) — targets a third-party library's own class names, not app markup.
- Icons: `lucide-vue-next` only
- Prisma singleton: `web/server/utils/prisma.ts` is the only place to instantiate PrismaClient

### Project conventions

- **Images**: Always use `useImageUrl()` composable to resolve artist/release images
- **Types**: All TypeScript definitions in `web/types/`
- **No scripts code in web app** - scripts are separate Rust binaries located in /scripts
- **Metadata is source of truth** - never use filesystem paths/folder names for artist, album, year or any other information
- **MusicBrainz IDs are definitive** - when embedded MB IDs exist in tags, use them directly without re-verification
- **`/img/` is public by design** - `server/middleware/auth.ts`'s `PUBLIC_PREFIXES` exempts artist/release artwork from session auth (avoids a DB round-trip per `<img>` request). Anyone with a direct URL can view artwork without logging in; nothing else under `/img/` is served. Acceptable since album art isn't sensitive data, but don't assume `/img/*` is access-controlled if you add anything else under that path.
- **Seed admin is `admin`/`admin`** - `prisma/seed.ts` creates it with `mustChangePassword: true`, so it's only usable to log in once before a real password is required. Fine as a bootstrap credential; don't "fix" it by hardcoding a different default (there's nothing safer to hardcode) or removing the forced change.

### Testing

- Every code change must consider tests. Before a change is done: run the relevant suite (`pnpm test:unit`, plus `pnpm test:e2e` for UI/flow changes). If touched code has no test, add one; if an existing test is now wrong or deprecated, update it in the same change. A behavior change that doesn't touch its tests is incomplete.
- Tests live under `web/test/**/*.test.ts` and `web/e2e/**/*.spec.ts`, mirroring the source path. `vitest.config.ts` defines three projects: `unit` (happy-dom; `test/helpers`, `test/server/utils`, `test/unit`), `nuxt` (`@nuxt/test-utils` environment; `test/stores`, `test/composables`, `test/components`), `integration` (node, own ephemeral Postgres via testcontainers, `fileParallelism: false`). Coverage thresholds are baselined in that config — ratchet up, never down.
- e2e runs Playwright against the **production build** (`pnpm build` then `node .output/server/index.mjs`); `e2e/global-setup.ts` logs in once and saves the session. A spec must never let a click reach `/api/terminal/run` for real — stub the route (see `e2e/scan-actions.spec.ts`), because the real endpoint spawns the Rust binaries against `MUSIC_DIR`.
- New pure logic goes in an importable helper/util (relative-imported) with a unit test - don't bury testable logic inside store closures or route handlers (extraction pattern: `server/utils/audioRange.ts`).
- Rust script changes still require `cd scripts && cargo build --release`; web changes require the touched test suite to pass before commit/deploy.

## Scripts

Shell wrappers at project root. Each uses a pre-built release binary - **rebuild after code changes**:

```bash
cd scripts && cargo build --release    # Must rebuild manually!
```

```bash
# Index & Sync
./index                       # Index local files (extract metadata, upsert to DB)
./sync                        # MusicBrainz sync (artists where lastIndexedAt > lastSyncedAt)
./index && ./sync             # Full workflow
./refresh                     # Shorthand: index all + sync all pending
./refresh --only "Name"       # Refresh specific artist (pipes artist IDs from index to sync)
./refresh --release "clxxx"   # Refresh single release (re-index + re-sync)
./index --only "Name"         # Index single artist (prefix match)
./index --only "Name" --exact # Index exact artist (no prefix matching)
./index --only "Name" --overwrite  # Force re-index (keeps existing covers)
./index --only "Name" --overwrite-with-images  # Force re-index + re-extract covers
./index --resume              # Continue from last checkpoint
./index --inspect             # Re-check existing files for metadata changes
./index --only "Name" --overwrite-with-images --prune  # Full re-scan: re-read tags/covers + delete rows for files that are gone
./index --prune               # Delete rows for missing files even when >20% of a folder changed (folder must be scanned and non-empty)
./index --folders "Artist/Album"   # Re-index exact folder paths
./index --release "clxxx"     # Re-index single release by LocalRelease ID
./index --resolve-artists     # Resolve artist tags against MusicBrainz only (no folder scan); alphabetical, skips names already in MbArtistLookup
./index --resolve-artists --dry-run  # Preview resolution decisions, write nothing
./index --resolve-artists --only "Name"  # Scope resolution to one artist (also honours --from/--to/--folders/--release/--exact)
./index --resolve-artists --overwrite    # Re-ask MusicBrainz for every name in scope, ignoring the cache
./index --skip-resolve        # Skip the end-of-run artist resolution pass
./index --canonicalize-artists           # Reconcile Artist rows with MusicBrainz (clear contradicted MB ids, rename to the canonical name, connect duplicates, sweep zero-link artists), then exit. Pure SQL, no network, no folder scan
./index --canonicalize-artists --dry-run # Preview the clears/renames/connections, write nothing
./index --delete              # Delete local data for matched artists
./index --emit-artist-ids f   # Write processed artist IDs to file (used by refresh)
./sync --only "Name" --exact  # Sync exact artist
./sync --only "Name" --overwrite   # Force re-sync
./sync --release "clxxx"      # Re-sync single release
./sync --delete               # Delete MB data for matched artists
./sync --verbose              # Show skipped MB releases
./sync --skip-mb-tags        # Skip writing MB IDs back to audio file tags
./sync --only-write-mb-to-files          # Backfill MB IDs from DB into file tags (no API calls)
./sync --only-write-mb-to-files --only x # Backfill for specific artist
./sync --catalogue-gaps       # Fast pass: populate MISSING catalogue entries (1 API/artist)
./sync --catalogue-gaps --overwrite  # Re-fetch all MISSING entries from scratch
./sync --artist-ids file      # Sync artists by ID file, one per line (used by refresh)
./sync --release "clxxx" --artist-hint "clyyy"  # Prefer this artist when a collab release has several main artists
./sync --recompute-scores     # Recompute every artist's averageMatchScore from the catalogue (pure SQL), then exit
./sync --repair-shared-release-ids [--dry-run]  # One-off: unbind LocalReleases that lost a shared-releaseId conflict

# Audit & Fix
./audit                       # Detect metadata issues → write to DB (all types)
./audit --corrupted           # Only detect corrupted TPE2 tags
./audit --orphans             # Only detect orphan artists
./audit --duplicates          # Only detect duplicate artists
./audit --missing             # Only detect missing metadata fields
./audit --enrichment          # Only detect enrichment gaps (BPM, mood, AcousticID, etc.)
./audit --duplicate-release   # Only detect duplicate local copies sharing one MB release (audit-only, no ./fix)
./audit --mismatched-release-id  # Only detect different-title local releases sharing one MB release (audit-only)
./fix --corrupted             # Apply PENDING corrupted TPE2 fixes (tag writes)
./fix --orphans               # Apply PENDING orphan artist fixes (delete from DB)
./fix --duplicates            # Apply PENDING duplicate artist fixes (merge B into A)
./fix --missing               # Apply PENDING missing metadata fixes (tag writes)
./fix --revert --corrupted    # Revert previously applied corrupted fixes
./fix --revert --mode undo-resolved --corrupted  # Revert but leave the issue RESOLVED (default mode is 'undo' → back to DETECTED)

# Destructive
./delete "Artist Name"        # Delete artist + cascade (kept as credit-only if credited elsewhere)
./delete "Artist Name" --files  # Same, plus delete their audio files inside MUSIC_DIR (+ emptied folders)
./delete "A;B" --dry-run      # Preview multi-artist deletion
./nuke                        # Full DB reset + image deletion
./nuke --keep-artist-img      # Full reset but preserve artist images
./nuke --only "Artist Name"   # Delete one artist + cascade (always exact match)
./nuke --only "Name" --dry-run  # Preview what --only would delete

# Other
./problems --audit                    # Scan every file for tag defects that break index/sync → problems.xlsx (READ-ONLY)
./problems --audit --only "Name"      # Scan one artist
./problems --audit --resume           # Continue an interrupted scan
./problems --audit --report-only      # Rebuild the xlsx from an existing spool (also picks up any --fix:* since the last report)
./problems --fix:year                 # Fix every year defect (ZERO/NON_NUMERIC/TWO_DIGIT/IMPLAUSIBLE): MB-verified match, no match ⇒ null, never a guess; marks fixed rows green + updates Summary counts
./problems --fix:year --dry-run       # Preview proposed matches/years, write nothing
./problems --fix:artist               # Fix every artist-field defect: fill ARTIST_MISSING from albumArtist/folder majority (no MB), then strip invisible chars
./problems --fix:artist --dry-run     # Preview, write nothing
./problems --fix:albumartist          # Fix every albumArtist-field defect: fill MISSING/UNKNOWN_ARTIST, rewrite UNRECOGNISED_VARIOUS to "Various Artists", strip invisible chars + trim (no MB)
./problems --fix:albumartist --dry-run  # Preview, write nothing
./extract-meta-images         # Extract embedded cover art → folder.jpg (500px, q80) for every release lacking a cover file; speeds up index
./extract-meta-images --dry-run       # Preview, write nothing
./extract-meta-images --only "Name"   # One artist
./analysis /path/to/music     # Standalone metadata quality HTML report → reports/
./playlists                   # Generate/update genre playlists
./playlists --dry-run         # Preview without changes
./playlists --report          # Show genre → group assignments
./playlists --group rock      # Update single group
./dissect                     # Parse errors.log → reports/errors.xlsx (--input/--output override paths)
./backup                      # pg_dump + image archive from the NAS → web/dump/
./restore [file.sql.gz]       # Load the latest (or named) dump into local PostgreSQL
```
Each script has a doc in `docs/scripts/`. `mosaic` has no wrapper — it is invoked by the web app
(`/api/labs/mosaic/generate`).

The web UI's scan buttons (`components/ScanActions.vue`, `components/artist/ScanActions.vue`) run
these same binaries through `/api/terminal/run`. Three intents: **check for new files** (unflagged,
MANAGER-usable), **re-check changed files** (`--inspect`, MANAGER-usable — the only non-destructive way
to pick up files replaced in place, since a default index skips any known `filePath`) and **full
re-scan** (`--overwrite-with-images --prune`, then `sync --overwrite`; ADMIN-only, since
`DESTRUCTIVE_FLAGS` in `server/utils/terminalCommand.ts` gates `--delete`, `--overwrite*`, `--prune`
and `--files`). Artist removal (`components/artist/DeleteDialog.vue` → `./delete`, ADMIN-only) is on
the same allow-list; its unchecked "Remove all files" switch is what adds `--files`.

**No UI caller passes `--skip-resolve`**, so every one of these already runs the artist-resolution pass
and its offline tail (canonicalize + orphan sweep) — the new behaviour needs no argument changes at any
call site (`ScanActions.vue` ×2, `ui/RefreshButton.vue`, `FirstScan.vue`, `autoScan.ts`). What matters is
that the tail is **scoped**: `--only`/`--folders`/`--release` runs narrow it to the artists they touched,
because `scoped_release_ids_for_filter` never returns `None` once a filter is set, and `None` means the
whole library downstream. Flag gating is a deny-list (`DESTRUCTIVE_FLAGS`), so no allow-list needs
extending when a flag is added — but a new *destructive* flag must be added there explicitly.

`Settings → Library` also carries the opt-in **auto-scan** (`server/utils/autoScan.ts`, ticked by
`server/plugins/monitor.ts` on the `MONITOR_PRIMARY` instance only, serialized through `runExclusive`).
Off by default; interval floor 1 hour. See `docs/GUIDE.md` for the user-facing walkthrough of all of
this.

### Fixing Wrong Artist Pages

When browsing reveals artists with bad names (track numbers, paths, garbage):

1. **Detect**: `./audit` - writes issues to DB
2. **Review**: `/issues` in the web UI - inspect and queue fixes
3. **Fix**: `./fix --corrupted` / `./fix --orphans` etc.
4. **Refresh**: `./refresh --only="..."` for file-writing fix types
5. **Iterate**: Re-run audit until clean

### Error Logs

On the NAS, script error logs are at: `sudo docker exec dmp cat /app/errors.log`

## API Endpoints

### Core
- `GET /api/artists` - paginated list with filters (letter, genre, search, score, sort)
- `GET /api/artists/[slug]` - artist detail with genres, URLs, stats
- `GET /api/artists/[slug]/releases` - all releases (unified MB + local)
- `GET /api/artists/[slug]/tracks` - all tracks
- `GET /api/artists/random` - one random artist
- `GET /api/releases/[id]/tracks`, `/info` - tracks in a release (merges local + MB missing); release detail

### Playback
- `GET /api/audio/[id]` - stream audio with HTTP range support + ETag
- `POST /api/tracks/[id]/play` - increment playCount
- `GET /api/tracks/[id]/info`, `/playlists` - track detail; playlists containing it
- `POST /api/tracks/explore` - 4-slider scoring (energy/era/familiarity/sound)
- `GET /api/tracks/random`, `/random-batch` - random track(s) for catalogue shuffle

### Library
- `GET /api/releases/latest` - recently added
- `GET /api/releases/last-played` - recently played
- `GET /api/releases/archive` - random archive pool
- `GET /api/search` - full-text across artists/releases/tracks
- `GET /api/timeline/decades`, `/[decade]`, `POST /timeline/refresh` - decade grouping; refresh the `dmp_timeline` materialized view
- `GET /api/genres` - all genres with counts
- `GET /api/stats`, `/stats/[type]`, `/app-stats` - library statistics; per-stat detail; dashboard counters

### CRUD
- `/api/playlists/*` - CRUD for playlists and playlist tracks
- `/api/favorites/*` - toggle favorite releases and tracks
- `/api/auth/login`, `/api/auth/logout`, `/api/auth/change-password`, `/api/auth/me` - session auth
- `/api/users/*` - admin user management (list/create/patch/delete)
- `/api/permissions/*` - view/edit the role permission matrix

### Downloads
- `GET /api/downloads/queue`, `/active`, `/status` - queue state (gated `sync.view`)
- `POST /api/downloads/acquire`, `/merge/[id]`, `/merge-all`, `/pause`, `/cleanup` - acquisition/merge pipeline (gated `downloads.crud`)
- `POST /api/downloads/cancel/[id]`, `/reject/[id]`, `/reject-all`, `/requeue/[id]`, `/requeue-all`, `/retry/[id]` - per-row/bulk state transitions (gated `downloads.crud`)
- `/api/downloads/sources` - per-source (slskd/RuTracker) config: GET gated `sync.view`, PUT gated `variables.edit`
- `GET /api/artists/monitoring` - monitored-artist list for the downloads Monitoring tab
- `PATCH /api/artists/[slug]` - toggle `monitored`

### Issues
- `GET /api/issues/summary` - counts per issue type
- `GET /api/issues/[type]`, `PATCH /api/issues/[type]/[id]` - per-type table; edit one proposed fix
- `POST /api/issues/[type]/queue`, `/queue-revert` - mark DETECTED → PENDING (or PENDING_REVERT)
- `GET /api/issues/history`, `POST /api/issues/history-undo`, `DELETE /api/issues/history` - applied-fix trail

### Settings
- `/api/settings` - GET (masked secrets)/PUT (only overwrites secrets on non-empty value)
- `GET /api/settings/public` - unauthenticated-safe subset for the client

### Scrobbling
- `/api/scrobble/connect`, `/callback` - Last.fm OAuth handshake
- `POST /api/scrobble/now-playing`, `/scrobble` - Last.fm now-playing + scrobble submission

### Labs
- `GET /api/labs/map/countries`, `/map/artists` - artist country map data (24h cache); artists per country
- `GET /api/labs/genome/artists`, `/genome/graph`, `/network/graph`, `/decades/stats` - graph + stats data
- `/api/labs/mosaic/*` - generate/cancel/list/delete mosaic images

### Operations
- `POST /api/terminal/run` - run an allow-listed script (SSE streaming, tmux-backed)
- `POST /api/terminal/stop`, `/reconnect`, `/unlock` - kill the session, reattach to a running one, clear a stale lock
- `GET /api/scan/status`, `POST /api/scan/unlock` - index/sync lock state; force-release it
- `GET /api/health` - health check (public)

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard: latest, recently played, playlists, favorites |
| `/browse` | Artist grid with letter/genre/score filters, infinite scroll |
| `/artist/[slug]` | Artist detail: header, releases (aggregated from connected artists), sync controls |
| `/explore` | 4-slider music discovery (energy/era/familiarity/sound) |
| `/playlists` | Playlist library |
| `/playlists/[slug]` | Single playlist with tracks |
| `/favorites` | Tabbed favorites (releases/tracks) |
| `/timeline` | Browse by decade/year |
| `/statistics` (+ 16 subpages) | Library stats dashboard; subpages break out individual stat views (artists, releases, tracks, genres, bitrate, size, plays, shortest, incomplete, unmatched, single-release, synced/art-coverage counts) |
| `/downloads` (+ 7 subpages) | Download queue shell; subpages are per-status tabs (downloading, failed, history, merge, monitoring, rejected, unavailable) |
| `/labs` (+ 5 subpages) | Labs index; subpages: map (world map by artist origin country), genome, mosaic, network, decades |
| `/issues` | Metadata issue overview - run audit, view counts per type |
| `/issues/<type>` (7 pages) | Per-type issue table - select, edit proposed fixes, queue for fix. One page each: corrupted, duplicates, duplicate-release, enrichment, mismatched-release-id, missing, orphans |
| `/issues/history` | Applied-fix history (undo/redo trail) |
| `/settings/*` (8 pages) | api-keys, downloads, library, monitoring, permissions, scrobble, storage, users |
| `/change-password` | Forced/voluntary password change |
| `/login` | Auth page |

## Player Store

The player (`stores/player.ts`) supports 5 shuffle modes:
- `off` - sequential playback
- `release` - shuffle within current release
- `artist` - shuffle within current artist
- `catalogue` - random tracks from entire library (prefetched buffer)
- `explorer` - score-based discovery using 4 sliders

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
| `/api/releases/archive` | 5 min |
| `/api/app-stats` | 2 min |
| `/api/timeline/*` | 5 min |
| `/api/labs/map/countries` | 24 h |

Invalidated on track play (`last-played`, `stats`, `artist:{slug}`) and timeline refresh.

## NAS integration (production server)

NAS target: TrueNAS at `SERVER_HOST` (`192.168.1.241`), deploy dir `DEPLOY_PATH` (`/mnt/SSD/web/dmp`),
music at `MUSIC_DIR` (`/mnt/dmp/mainstream`). All three come from `web/.env` — the values here are the
current ones, not hardcoded anywhere.

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

Scripts-only knob: `MB_MIN_DELAY_MS` sets the MusicBrainz inter-request floor for `index`, `sync` and
`problems` (default 1100, clamped to 1100–10000). Raise it only if MusicBrainz is genuinely
rate-limiting you. It does nothing for the "server busy" 503s, which are MB load-shedding while we sit
at ~1/15 of the allowance — those are absorbed silently and counted in the run summary.
