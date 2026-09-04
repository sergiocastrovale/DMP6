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
- **A release can be owned without being bound.** A bonus disc is its own MB release group, but a
  folder holding CD 01 + CD 02 binds to the *album* group — so coverage (which reads binds) called the
  bonus disc missing and the downloader fetched tracks already on disk. `sync::owned::claim_owned_bundle`
  catches that before a gap is written: all tracks present in one local release, matched by title **and**
  ±5s duration (live re-recordings share titles), strict superset, ≥3 tracks. It links the local tracks
  to that release's MB tracks and marks it `COMPLETE` / `statusReason = 'Owned as part of "…"'`;
  `get_covered_release_group_ids` then treats a fully track-linked group as covered. Never writes
  release-level MB ids onto a partially-matching folder — that would flip the folder's id consensus.
- **Only audio media count toward a release's track list.** A CD+Blu-ray edition's bonus video disc
  used to be flattened into the expected track count alongside the audio, so a perfect audio rip could
  never pass the completeness gate (the "MOON" incident: 4/4 audio tracks scored MISSING_TRACKS against
  a 5-track expectation that included a live-video bonus track). `common::mb::allowlist::is_audio_medium`
  gates by MusicBrainz medium **format** (Blu-ray, DVD, VHS, …) via a deny-list, never the per-recording
  `video` flag — MusicBrainz reports that flag `false` even on video-only media. Unknown/missing formats
  default to audio (over-count, not silent data loss). The single flattening point is
  `common::mb::api::flatten_audio_tracks`, called by both `mb_get_release_tracks` and
  `mb_get_release_by_id` — every downstream count (status matching, `MusicBrainzReleaseTrack` rows, the
  web track list, card `trackCount`) inherits the filter for free. The composed `format` column (e.g.
  "Blu-ray, CD") intentionally stays unfiltered — it's display metadata, not a completeness input.
- **A merge discarded for a genuine shortfall must not orphan the MB release it just bound.**
  `stampMerged`'s discard branch (`web/server/utils/promote.ts`) deletes the failed LocalRelease and
  also deletes the `MusicBrainzRelease` `sync --release` had just bound to it — but only when nothing
  else still needs that row: another `LocalRelease` bound to it (duplicate-copy case), an owned-bundle
  claim via `LocalReleaseTrack.mbTrackId` (see above), or a `MISSING` placeholder (that one is kept on
  purpose — it's what makes the release re-downloadable). `sync::db::delete_orphaned_mb_releases` /
  `retire_owned_missing_placeholders` are the equivalent sweeps at the end of every sync run and the
  `--catalogue-gaps` path; the orphan sweep must run before the placeholder-retire sweep at every call
  site, or a discarded download's orphan makes retire delete the placeholder instead of the orphan.
- `LocalRelease` grouped one-per-folder: `groupKey` (unique) = `"folder:{folderPath}"` (root-level files fall back to `"meta:{slugTitle}:{year}:{slugArtist}"`). Per-track MB ids are NOT part of the key — folder is the physical release unit; sync matches folder→MB by embedded-id consensus, then a guarded title+artist search, binding only Official Album/EP — plus Single, but **only** when the files' own MB ids point at it (`allowlist::is_allowed_tagged`; MB files many owned 4-track CD "EP"s under a Single group). Searches and catalogue gaps never produce a Single. A candidate the allow-list rejects (bootleg edition, Single-typed search hit) gets one search-tier retry before the release is left UNMATCHED. Keying on per-track ids shredded compilations into per-track fragments — see `docs/scripts/index.md`, `docs/scripts/sync.md`.

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
- Zero custom CSS: Tailwind utility classes only. No component or page has a `<style>` block — the
  two cases that genuinely need CSS Tailwind can't express (the animated conic-gradient genre border's
  `@property --angle` + `@keyframes`; Leaflet's own `.leaflet-container`/`.leaflet-control-zoom a` class
  names) live as `@utility`/global rules in `web/assets/css/main.css`, driven by the design tokens. If a
  new screen needs something Tailwind utilities truly can't express, it becomes a global rule there too
  — never a component-local `<style>` block. See `docs/design_system.md`.
- **Design system**: colour ramps, type scale, radii and shadows live in `web/assets/css/theme.css` (`@theme static`, never hand-edit without updating `docs/design_system.md` — there is no separate generator, the file itself is the source of truth). Reusable Tailwind utility-string builders (`button()`, `sw()`, tone maps, `ui.*`) live in `web/helpers/ui.ts` — reuse an existing recipe or extend it with `cx()`; never redefine one locally, and only promote a new one once a utility string repeats a second time. Status/match-score colour has exactly one source: `helpers/constants.ts`'s `statuses[]`/`scoreRanges[]`, resolved through `toneBg`/`toneText`/`toneFill`. See `docs/design_system.md` for the full primitive catalogue and the state/accessibility contract every interactive component follows.
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
- Tests live under `web/test/**/*.test.ts` and `web/e2e/**/*.spec.ts`, mirroring the source path. `vitest.config.ts` defines three projects: `unit` (happy-dom; `test/helpers`, `test/server/utils`, `test/unit`), `nuxt` (`@nuxt/test-utils` environment; `test/stores`, `test/composables`, `test/components`), `integration` (node, own ephemeral Postgres via testcontainers, `fileParallelism: false`). No coverage thresholds are enforced.
- e2e runs Playwright against the **production build** (`pnpm build` then `node .output/server/index.mjs`); `e2e/global-setup.ts` logs in once and saves the session. A spec must never let a click reach `/api/terminal/run` for real — stub the route (see `e2e/scan-actions.spec.ts`), because the real endpoint spawns the Rust binaries against `MUSIC_DIR`.
- **Always run e2e via `pnpm test:e2e`, never bare `playwright test` / `npx playwright test`.** `web/.env`'s `DATABASE_URL` points at the live NAS production DB (192.168.1.241) — a bare `playwright test` loads `.env` directly and runs the whole suite (fixture creation, login, deletes) against production. `pnpm test:e2e` runs `e2e/with-test-db.ts` first, which spins up a disposable testcontainers Postgres (or `DATABASE_URL_TEST` if set) and overrides `DATABASE_URL` before handing off to Playwright — that's the only safe entrypoint. If you need to invoke Playwright directly for a one-off (trace viewer, `-g` filter, debugging a hang), export `DATABASE_URL` to a local/disposable DB first, or add `--ui`/flags to the `test:e2e` script rather than dropping to `npx playwright test` raw.
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
./sync --catalogue-gaps       # Fast pass: populate MISSING catalogue entries (few API calls/artist)
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
./artist-photos                # One-off: backfill missing artist photos (Wikidata/Wikipedia/Fanart.tv) → IMAGE_DIR + MUSIC_DIR/{Artist}/folder.jpg + DB
./artist-photos --dry-run      # Report candidate/source availability, write nothing
./artist-photos --limit 50     # Cap the run for validation
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

The web UI's scan buttons run these same binaries through `/api/terminal/run`, from **two separate
action lists** in `helpers/constants.ts` — the surfaces stopped sharing one list once the artist
actions became rebuilds rather than scopes of the library-wide ones:

- `scanActions` → `components/settings/ScanActions.vue`, the library-wide grid: **check for new files**
  (unflagged), **re-check changed files** (`--inspect` — the only non-destructive way to pick up files
  replaced in place, since a default index skips any known `filePath`), **index only**, **sync only**,
  all MANAGER-usable, plus ADMIN-only **full re-scan** (`--overwrite-with-images`, then `sync
  --overwrite`; never `--prune` library-wide, where a half-mounted share would defeat the ratio guard).
- `artistScanActions` → `components/artist/ScanActions.vue`, four per-artist intents: **scan for new
  files** (`index --only <folders> --exact` + `sync --only <name> --exact`, the only MANAGER-usable
  one), **rebuild everything** (`delete` + `index --overwrite` + `sync --overwrite`), **rebuild from
  files only** (same without the sync — the artist stays unmatched until one runs) and **re-match from
  scratch** (`sync --only --overwrite` alone). The last three are ADMIN-only.

`./delete` takes the artist **name** positionally and needs `--y`: it prompts on stdin, which nothing
answers in a tmux-backed run. `index` is scoped by the artist's on-disk **folders**, which is why the
two take different arguments. ADMIN gating is `DESTRUCTIVE_FLAGS` in
`server/utils/terminalCommand.ts` (`--delete`, `--overwrite*`, `--prune`, `--files`) plus
`COMMAND_PERM`, which puts `./delete` and `./nuke` at ADMIN outright. Artist removal
(`components/artist/DeleteDialog.vue` → `./delete`) is the same binary; its unchecked "Remove all
files" switch is what adds `--files`. `sync --catalogue-gaps` is CLI-only — no button runs it.

**No UI caller passes `--skip-resolve`**, so every one of these already runs the artist-resolution pass
and its offline tail (canonicalize + orphan sweep) — the new behaviour needs no argument changes at any
call site (`settings/ScanActions.vue`, `artist/ScanActions.vue`, `ui/ButtonRefresh.vue`, `dashboard/FirstScan.vue`, `autoScan.ts`). What matters is
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
- `GET /api/downloads/enabled` - Soulseek on/off switch (`Settings.downloadsEnabled`), gated `sync.view`; written via `/api/settings`
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
| `/downloads` (+ 5 subpages) | Download queue shell; subpages are monitoring, merge, queue (downloading/failed/unavailable/rejected as `?filter=` subtabs of one page), history, events |
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

State persisted to localStorage (queue capped at 200 tracks). **The restore read runs in
`onMounted`, never inline in the store's `setup()` body** — Nuxt's Pinia SSR hydration patches
every ref on a store back to the server-rendered value immediately after `setup()` returns
(`createSetupStore` does `prop.value = initialState[key]` per ref, from the payload captured
before `setup()` ran), and this store always renders empty server-side since the restore is
`import.meta.client`-gated. An inline restore worked for one synchronous tick and then got
silently clobbered back to `null`/`[]` before any component had mounted — a reload only
"restored" the bar for a flash before wiping it, and the debounced save watcher then persisted
that wiped state right back to localStorage, corrupting the next restore too.
`e2e/player-persistence.spec.ts` is the regression test; it must do a real `page.reload()`
(a component-tree unit test never round-trips through SSR, so it can't see this).

## Visualizer

Fullscreen WebGL visualizer over whatever is playing. Opened from the player bar (before the volume
slider), from Explore's header (beside the TV-mode button), or with `v` from anywhere; `Esc` exits.
Four fragment-shader presets — chaos, fractal, buddhabrot, julia — switchable in the auto-hiding
HUD or with `1`–`4`/`n`. All four registered in one place, `helpers/constants.ts`'s
`visualizerPresets` (id/label/description/key) - `Overlay.vue`'s digit shortcuts, `Hud.vue`'s
buttons and `useVisualizer.ts`'s cycling/persistence are all driven off that array generically, so
adding or renaming a preset touches only `helpers/constants.ts` and its shader/uniform wiring, never
those three. `decodeVisualizerPreset` falls back to `chaos` for any unrecognised
`localStorage['dmp-visualizer']` value, so swapping a preset's id never needs a migration.
`buddhabrot`/`julia` replaced an earlier `tunnel` (demoscene ring corridor) and `spectrum` (FFT
bars + oscilloscope) once the preset lineup became fractal-only by design; removing them also
removed `accent()`/`uHue`, `freeColor()`/`hueBase()`/`uSeed`, and the three FFT/waveform/peak data
textures (`uSpectrum`/`uWaveform`/`uPeaks`, `helpers/audioBands.ts`'s `decayPeaks`) - nothing left
in this file reads the accent theme colour or literal audio curves, only the three scalar bands
(`uBass`/`uMid`/`uTreble`) and level.

Chaos, Fractal and Julia are all Julia sets but deliberately unlike each other. Fractal is one
centred 6-fold-polar-fold kaleidoscope with an orbit-trap glow, normalised by viewport **height
only** (not `centered()`'s shorter-edge normalisation) with no wrapping - so on anything wider than
square it naturally extends past the left/right edges rather than being scaled down to fit inside
them. (A scattered-multi-copy version, then a horizontally-tiled-repeat version, were both tried and
reverted - neither was wanted; it's one fractal, cropped by the viewport, not repeated.) Julia
iterates `z <- z^n + c` with `n` drifting between validated targets (`uJuliaPower`; see
`pickJuliaTarget()` a few paragraphs down for "validated" and why it matters), so its symmetry order
visibly changes over time - the thing that makes it a distinct third Julia set next to Chaos's
dendrite and Fractal's fixed six-fold kaleidoscope. The first cut computed `z^n` directly via polar
form (`r^n·(cos nθ, sin
nθ)`, i.e. `atan2` + `pow`) inside the iteration loop every step - mathematically the standard way
to raise a complex number to a real power, but `atan2` has a genuine branch-cut discontinuity at
θ=±π, and re-deriving `z^n` from it on every one of 48 iterations re-triggers that cut every step:
across that many compounding iterations, pixels a hair apart at the start could land on opposite
sides of the cut at different steps and diverge completely, which read as literal tears sheared
across the whole frame, not the hoped-for organic filigree - a real bug the user caught, not a
matter of taste. There is no smooth version of a genuinely fractional complex power; the fix
instead is `zpow()`/`juliaField()` in the shader: raise `z` to an *integer* power via repeated
complex multiplication (pure polynomial, no `atan` anywhere, hence no branch cut, ever), run the
full escape iteration once at `floor(n)` and once at `ceil(n)` - two clean, independent, cut-free
Julia sets one integer apart - and cross-fade their escape/trap fields by `fract(n)`. That isn't a
literal `z^5.5`; it draws the real power-5 and power-6 sets and blends how brightly each pixel
reads between them, which looks like a continuous morph with none of the artifact - the standard
real-time technique for animating a Multibrot's power. Chaos gets its `c` from
`helpers/visualizer/juliaPath.ts` on the CPU, one search per frame,
and the invariant that search enforces is the whole preset: **`c` must land just outside the
Mandelbrot set**. Inside it, the filled Julia set has interior, which renders as one flat slab of
colour that fills the screen as soon as you zoom — the "giant blob". Just outside, there is no
interior at all (the set is a dendrite), so every pixel carries an escape gradient and the frame is
spiral filigree throughout; too far outside and everything escapes in a few iterations and flattens
to a gradient, hence an escape-count *window*, not merely "outside". Radially scaling a cardioid
boundary point outward does **not** achieve this and was the original bug: at θ≈π that gives
-0.7875, deep inside the period-2 bulb. The search instead steps along the cardioid's outward normal
until it is clear of whatever component it started in (bulbs vary hugely — the period-2 one is 0.5
across), then bisects for the escape window. It runs CPU-side because `c` is one number shared by
every pixel. The view spins while it breathes in and out (bounded, not a one-way zoom, which would
eventually blow through float precision left open a while) — that's the "spiraling into infinity"
motion. Chaos's whole camera transform (zoom, spin) is audio-blind by design - it used to swell
zoom with loudness, which made the frame visibly jump in scale on every snare/kick hit. Its colour
is its own thing: `components/visualizer/Canvas.vue` runs an explicit CPU-side hue morph
(`helpers/visualizer/hueMorph.ts`) - ease from one random hue to another over a random 5-9s, then
pick the next target and repeat - uploaded as `uChaosHue`, read by `chaosColor()` in the shader.
Chaos's palette is 3-5 anchors spread evenly round the wheel off that one morphed hue (ground:
dark/saturated, mid: pale filigree, core: hot highlight - `uChaosPalette`, re-rolled alongside the
hue target), composited by `chaosMix()` keyed on escape depth/trap proximity rather than additive
layering - additive layering was tried first and is why every region still read as one dominant
colour with thin accents; mixing resolves each pixel toward one anchor, the way a real
orbit-trap-coloured fractal render does. `chaosColor()`/`chaosRole()`/`chaosAnchor()`/`chaosMix()`
live in the shared, exported `PRELUDE` (not inside Chaos's own preset string) precisely so Fractal,
Julia and Buddhabrot's present pass can all reuse the identical strategy off the *same*
`uChaosHue`/`uChaosPalette` state Chaos drifts, so switching between any of the four presets stays
visually continuous rather than jumping to an unrelated palette.

Fractal's `c` also walks Chaos's own boundary path (`helpers/visualizer/juliaPath.ts`), eased
between two random points on it over a random 7-14s (`FRACTAL_MORPH_MIN_S`/`MAX_S` in `Canvas.vue`,
the same `lerpHue`-eased A-to-B idiom Chaos's hue morph uses, just applied to a path phase) - that's
the "seamlessly transitions to another fractal" shape change, independent of Chaos's own continuous
`JULIA_SWEEP` crawl along the same path. Unlike Chaos, Fractal *wants* interior sometimes (that's
what its orbit-trap glow textures), so a straight interpolation between two path points briefly
dipping inside the set during a transition just reads as a kaleidoscope petal closing up, not a bug.
Julia's own `c` used to orbit a plain live circle instead (radius grows with `n`, bass nudges the
angle, mid the radius - the design Fractal itself used before Fractal moved onto Chaos's boundary
path), but that circle's radius (0.35-0.8) turned out to sit squarely in the regime where a Julia
set is mostly interior: c=0 is the *exact* unit disk, entirely interior, and every |c| that small
stays close enough to that regime that huge connected areas of the visible frame land inside the
filled set - one flat colour filling the screen, a real bug the user caught with a screenshot, not
a matter of taste. A numeric sweep (not intuition - a naive "did every probe fail to escape" check
never found a near-100% blob anywhere in that radius range) traced the actual mechanism to the
shader's own structure/colour formula: it saturates to a single constant (`chaosMix()` picks the
same anchor) for any point whose smooth escape value climbs past roughly 0.6, which a much wider
swath of the frame does at small `|c|` even though most of those points technically do escape
eventually - the bug was never really about points literally getting stuck. `c` and `n` are now
both picked together and validated on the CPU by `helpers/visualizer/juliaField.ts`'s
`pickJuliaTarget()` - the same idea as Chaos/Fractal's boundary-path validation, adapted to Julia's
own iteration and to probing a whole grid across the visible frame rather than one curve, since
Julia's `z` starts at the pixel's own position, not always the origin the way a Mandelbrot-style
search assumes. The view itself is also tighter than the original (`JULIA_VIEW_SCALE = 0.35`,
`c`'s radius restricted to `[JULIA_RADIUS_MIN, JULIA_RADIUS_MAX] = [0.75, 1.05]`, both found by the
same sweep) - a wide flat view of a valid Julia dendrite reads as sparse/empty regardless of `c`,
the same reason Chaos's own zoom is "0.5x to 5x" rather than one flat wide shot. The picked target
holds still for a random 5-12s, then eases to a freshly-picked one over a few seconds -
`Canvas.vue`'s `juliaHoldUntil`/`juliaFrom`/`juliaTo`, no beat involved, just a timer; a beat-gated
version (wait for the next kick after the hold elapses) was built and then explicitly asked to be
removed in favour of this simpler always-on-a-timer version.

Fractal is the only preset still wired to `uBass` at all (its shape/zoom reads it directly) - Julia
used to as well (bass nudged its old live orbit's angle) until that whole orbit was replaced by the
validated target picker above, and Buddhabrot never has. Fractal reacting to `uBass` used to mean
it reacted to every single kick. `components/visualizer/Canvas.vue` gates that: `isBeat()`
(`helpers/audioBands.ts`) flags a real onset (bass clearing both a ratio over its own rolling
baseline and an absolute floor, so a quiet verse's kicks still register), and the bass value
actually sent to Fractal's shader is held constant except right after a beat that lands once a
random 5-9s freeze window has elapsed - a quiet stretch, one clean jump on the beat, then quiet
again, instead of continuous jitter. `isBeat()`'s only remaining use in this file is that one
gate - the "wait for the next beat" idea was tried for Julia/Buddhabrot's own target changes too
and explicitly asked to be removed in favour of a plain timer, so nothing else in the visualizer
reads a beat at all.

**Buddhabrot** (`helpers/visualizer/buddhabrot.ts`) is structurally unlike the other three: a
histogram of escaping Mandelbrot orbits' *trajectories*, which isn't a function of a pixel's own
position, so it can't be one fragment shader like the rest - it's this app's first render-to-texture
use, first blending, first multi-frame GPU state, and `renderer.ts` only ever calls its four exported
functions (`resize`/`draw`/`reset`/`dispose`), never touching its GL state directly.

**Nothing may be plotted until an orbit is known to escape.** That is the whole algorithm, and the
one thing every earlier version of this file got wrong. Canonically: iterate `z <- z² + c` to
`maxIter` plotting *nothing*, and only if it escaped, re-run it and plot every step. Interior orbits
must contribute exactly zero - that is what leaves the set's interior a void and makes the
silhouette hollow. The original design instead plotted orbits *as they iterated*, guarded only by a
50-iteration Mandelbrot-membership test inside the GPU reseed. 50 iterations does not remotely
resolve a near-boundary `c`, which is precisely what reseeding draws, so interior and near-periodic
orbits were admitted constantly and each then splatted for its whole ~400-frame lifetime - depositing
density exactly where the image has to stay black. That is the *anti*-Buddhabrot filling in the void,
and it rendered as an opaque cloud with no structure whatsoever. Several rounds of exposure, decay,
palette and seed-entropy tuning each changed the colour of the mush and none produced a shape,
because by then the wrong points are already in the buffer.

The fix moves the test to where it can be done properly. `helpers/visualizer/buddhabrotMath.ts`'s
`generateSeedPool()` builds seeds on the CPU, iterating each candidate to `SEED_MAX_ITER` (2000) and
keeping only those escaping with a count of at least `SEED_MIN_ESCAPE` (40 - below that a `c` is far
outside and draws a short featureless arc). Crucially it **quantises before verifying**
(`quantizeStateValue`/`stateLevel`, the exact JS mirror of the GLSL codec, `Math.fround` included):
near the boundary a 1e-4 nudge moves an escaping `c` inside the set, so the value proven to escape
must be the value the GPU actually iterates, not a float64 near-miss of it. Because every live `c`
provably escapes, plotting an orbit as it iterates is *mathematically identical* to the canonical
replay pass - the test simply already happened, once per seed, on the CPU. Escape is then the only
thing that ends an orbit; `SAFETY_RESEED_PROB` (1/900) survives purely as a backstop against
fixed-point drift on the fallback path, far too rare to bias the histogram. The pool reaches the GPU
through `VisualizerFrame.buddhabrotSeeds` and is refilled a slice per frame in `Canvas.vue`
(`BUDDHABROT_SEEDS_PER_FRAME`), which both amortises the verification cost and keeps rotating which
constants are in play.

Passes per frame: **advance** (one `z <- z² + c` step per live sample, ping-ponged between two state
texture pairs - `z` and `c` each get their own, since a fragment shader can't write two targets
without MRT, so both passes recompute the identical escape verdict from identical inputs; on escape
the texel reseeds from the pool), **splat** (one `gl.POINTS` vertex per state texel, additively
blended into a canvas-proportioned accumulation texture - `O(live samples)` per frame, deliberately
not the `O(samples × orbit length)` "re-iterate the whole orbit every frame" scheme, tried and
rejected for that quadratic blowup - drawn **twice**, the second time mirrored in the real axis,
which the Buddhabrot is symmetric about, for a free doubling of effective samples), **decay**
(always on, not fallback-only - see below), and **present** (log tonemap + the shared `chaosMix()`
palette).

**Motion.** The sampled region Canvas.vue draws seeds from walks Chaos's own boundary path
continuously, every frame (`BUDDHABROT_SWEEP`, `= JULIA_SWEEP * 5`) - the same idiom as Chaos's own
`uJuliaC` - rather than holding still and jumping. Holding still for 60-120s and jumping, with the
accumulation integrating with no decay at all so detail could keep sharpening indefinitely, was the
original design and was explicitly rejected: once a histogram is a few seconds old it barely changes
frame to frame, so the whole preset read as a slideshow of static photographs popping to a new one
occasionally, not something alive the way Chaos's continuously-morphing dendrite is. `DECAY_HALF_LIFE_S`
(2.5s, always applied now - not RGBA8-fallback-only as an earlier version of this file had it) is
short specifically so the accumulated image can actually follow that continuous drift instead of
blurring into an average of everywhere it has ever pointed; the seed pool in Canvas.vue fully turns
over in about a second for the same reason, tracking the region rather than lagging it.

Two more things the references made unavoidable. **The projection must be aspect-corrected**
(`projectionScale()`): clip space maps to each viewport axis independently, so a single shared
divisor stretches the entire plane by the canvas aspect - on a 2.4:1 canvas that smears the
silhouette 2.4× wide and no colour tuning can make it recognisable. `VIEW_SCALE` frames the short
edge at `1.45 / 4` - 4x tighter than the silhouette's own full extent, deliberately overflowing the
frame per request, rather than the whole shape sitting centred with room around it. **And the
accumulation must hold real dynamic range**: the reference renders span orders of magnitude between
core and filaments, while RGBA8 holds only 256 levels; a per-frame decay on top of that pins every
pixel to a steady state proportional to its hit rate, compressing everything into a handful of
levels of flat mush. Where WebGL2 + `EXT_color_buffer_float` allow it, this accumulates into
`RGBA32F`/`RGBA16F` instead (`EXT_float_blend` and `OES_texture_float_linear` gate which of those,
and whether the result is filterable - see `detectFloatSupport()`), which holds enough range that
the same short decay still resolves real filament detail instead of banding.
`estimateNormalisation()` predicts the hottest density from elapsed frames and the decay factor
(rather than a pipeline-stalling `readPixels` or a reduction pass) and `logTone()`'s curve lifts the
faint filaments against it - linear exposure cannot render this image, it either clips the core flat
or leaves the filaments at zero. Audio touches exposure only, never the density field - same
reasoning as Chaos's audio-blind camera.

This module is the only thing in the app that ever turns blending on or touches a non-default
framebuffer, so its `draw()` must leave blending disabled and the default framebuffer/full-canvas
viewport restored on every return - no other preset resets that state itself, they all just assume
it. `createBuddhabrotPass()` returns `null` (checked via `checkFramebufferStatus` on its render
targets, and `MAX_VERTEX_TEXTURE_IMAGE_UNITS` for the splat pass's per-vertex texture read) if this
GPU can't support it, and `renderer.ts` falls back to a single-pass
Mandelbrot-with-orbit-trap-glow approximation compiled from the normal `FRAGMENT_SHADERS.buddhabrot`
entry - the same subject, same shared palette, degrading to "the same preset, softer" rather than a
black screen. The RGBA8 + 16-bit-fixed-point path is a complete second tier below that, decay
included: it cannot look like the references, but it renders.

- **The Web Audio tap is one-shot and permanent.** `composables/useAudioAnalyser.ts` holds
  module-level `AudioContext`/`MediaElementAudioSourceNode`/`AnalyserNode` singletons because
  `createMediaElementSource()` may be called **once per element, ever** — a second call throws
  `InvalidStateError`. Once called, the element's output routes through that graph, so the source
  must stay connected to `ctx.destination` or **playback goes silent app-wide**. Hence no
  `dispose()`, and hence the graph is built lazily on first visualizer open rather than at store
  init: a user who never opens it keeps the untouched plain-element path. `/api/audio/[id]` is
  same-origin and `crossOrigin` is never set, so the tap doesn't silence output for CORS reasons.
- `stores/player.ts`'s `getAudioElement()` returns `null` until first playback, so the toggle is
  gated on `player.currentTrack` — there is nothing to tap before then.
- The overlay is a teleported `fixed inset-0` layer, **not** `useChrome().hide()`: it must be able to
  stack above Explore's cinema mode, and `requestFullscreen` needs a real element. See
  `docs/design_system.md` → "Full-screen surfaces". iOS Safari rejects `requestFullscreen` on a
  non-`<video>`; the CSS-only fallback is why the overlay handles Escape itself.
- `prefers-reduced-motion` is honoured in `components/visualizer/Canvas.vue` by damping the clock —
  `main.css`'s app-wide reduced-motion block only neutralises CSS animation and cannot reach a
  `requestAnimationFrame` loop.

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
