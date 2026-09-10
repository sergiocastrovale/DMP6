# DMP v6

Personal music library web app. Scans local audio files, matches vs MusicBrainz, browse/playback/discovery/analytics.

## Stack

- **Web**: Nuxt 4 + Vue 3 + TS + Tailwind v4 + Pinia + Prisma + PostgreSQL
- **Scripts**: Rust CLI, one crate/binary under `scripts/` (`index`, `sync`, `audit`, `fix`, `problems`, `analysis`, `nuke`, `delete`, `playlists`, `extract-meta-images`, `dissect`, `mosaic`, shared `common` lib)
- **Mobile**: PWA + Capacitor Android wrapper in `mobile/` pointing at `MOBILE_SERVER_URL` — see `docs/pwa/pwa_capacitor_android.md`
- **Deploy**: Docker on TrueNAS via `./deploy`
- **Optional**: Redis (ioredis), S3 image storage, Cloudflare Tunnel

## Data Model

Dual tree linked by match IDs:

```
MusicBrainz (canonical): Artist ←→ MusicBrainzReleaseArtist ←→ MusicBrainzRelease → MusicBrainzReleaseTrack
Local (files):           Artist ←→ LocalReleaseArtist ←→ LocalRelease → LocalReleaseTrack
                          Artist ←→ TrackRelatedArtist ←→ LocalReleaseTrack

LocalRelease.releaseId → MusicBrainzRelease.id
LocalReleaseTrack.mbTrackId → MusicBrainzReleaseTrack.id
Artist.primaryArtistId → Artist.id (dup → canonical)
```

- `LocalReleaseArtist` = owners (owner tag = `albumArtist`, unless VA placeholder → track's own `artist` tag decides). One definition: `index::resolve::owner_tag`.
- `TrackRelatedArtist` = credited only ("appears on"). Ownership derived (`EXISTS(LocalReleaseArtist)`), never a flag column. Compound-tag split: ` with `/`feat.` → first owns rest credited; ` & `/`,` → all co-own.
- Artist identity resolved via MB, never punctuation-guessed (`common::mb::resolve`). Tiers: embedded `Artists[]`/`MusicBrainzArtistId[]` → `MbArtistLookup` cache → whole-string MB search → span search → unverified atom fallback. Separators need surrounding spaces except `\`,`\\`,`|`; bare `/` `+` are not separators (AC/DC). `\\` (ID3v2.3 multi-value) must match before `\`.
- `Artist.country` = ISO 3166-1 alpha-2, from sync. `Artist.primaryArtistId` set by sync + `./index --canonicalize-artists`, only when both names' `MbArtistLookup` resolve to same MB ID (raw `musicbrainzId` match is unsafe — leaks onto compounds).
- `ReleaseStatus`: COMPLETE | INCOMPLETE | EXTRA_TRACKS | MISSING_TRACKS | MISSING | UNKNOWN | UNMATCHED. `PlaylistType`: MANUAL | GENRE | REGION.
- **Containment ≠ ownership.** A box set / compilation / two-disc folder holding every track of release A does **not** mean you own A — different edition, usually a different master. `sync::owned::detect_containment` (title + duration ±5s, strict superset, ≥3 tracks) only annotates: the release stays `MISSING`, stays counted as a gap, stays downloadable, and gets `statusReason = 'Recordings inside "<container>"'`. Read-only — never links tracks, never touches files, never rejects a queued download. Note is carried across syncs (`get_contained_notes_for_artist`); `--overwrite` re-derives it at **no MB cost** — `detect_containment` is pure and scores tracklists handed to it by `mb_get_official_artist_catalogue`, the one artist-scoped browse sync already makes for `official_rg_ids` (`+recordings` on it is free). It used to fetch its own, 1 paginated browse per gap per artist per run with negative results never cached: avg 14.8 calls/artist, 813 at worst, ~10s each — the single largest avoidable cost in a sync run. Only Official editions are considered now (a per-group fetch also kept status-absent ones); every gap has already passed `is_allowed_gap`, so one always exists, and the narrowing touches `statusReason` only. Web reads it via `containmentContainerTitle()`. The pre-2026-09 `claim_owned_bundle` marked these COMPLETE and repointed the container's own `mbTrackId`s — undo with `scripts/sql/undo_owned_bundle_claims.sql`.
- **Only audio media count toward track list.** `common::mb::allowlist::is_audio_medium` gates by MB medium **format** (deny-list), never per-recording `video` flag (MB reports it false even on video-only media). Unknown format defaults audio. Single flattening point: `common::mb::api::flatten_audio_tracks` (used by `mb_get_release_tracks`/`mb_get_release_by_id`/`mb_get_official_artist_catalogue`) — every downstream count inherits it. **MB caps `inc=recordings` browses by response size, not `limit`** (`OK Computer`: `release-count: 39`, 31 returned for `limit=100`), so every browse loop pages on the reported count, never on a short page — doing the latter silently dropped all 8 `OKNOTOK` deluxe editions.
- **Box set = one MusicBrainzRelease, N `MusicBrainzReleaseMedium` rows**, never several releases (see `docs/sync_decisions.md`). MB has no box-set entity, no id-link disc→standalone album — only shared identity is **recording** (`recordingId`). `index` never folds multi-medium; `sync::boxset::run_repair` (auto, tail of every sync, scoped by `--only`/`--exact`) does binding + fold/dissolve + equivalence. Binding: tag consensus first, else `boxset::plan_box_bind` tracklist matcher — folder→medium pairing is 3 passes, strictest first (exact title +-5s → exact title +-15s for master drift → one title containing the other, unambiguous only); every sibling must resolve to exactly one medium or the whole group is rejected. A binding the box pass owns (`boxReleaseId` or `mediumPosition` set) wins over the folder's own tags on re-sync, and skips the deluxe-edition upgrade, or the two passes fight and the disc never scores. Equivalence 3 tiers (recording equi-join → artist-scoped title+duration → containment). `mediumCount>1` + ≥2 equivalent media → **dissolves** (each disc binds standalone via `boxReleaseId`/`boxMediumPosition`); 0-1 equivalent → **folds** into one `LocalRelease`. Needs `LocalReleaseMember` row/disc or re-scan re-splits it.
- **Discarded merge must not orphan its just-bound MB release.** `stampMerged` discard branch (`web/server/utils/promote.ts`) deletes MusicBrainzRelease only if nothing else needs it (other LocalRelease, a track still pointing at it via `mbTrackId`, or MISSING placeholder — kept on purpose, makes it re-downloadable). `sync::db::delete_orphaned_mb_releases` must run before `retire_owned_missing_placeholders` at every call site.
- `LocalRelease.groupKey` (unique) = `"folder:{folderPath}"` (fallback `"meta:{slugTitle}:{year}:{slugArtist}"`). Per-track MB ids NOT part of key — folder is the physical unit. Binds only Official Album/EP, +Single only when files' own MB ids point at it (`allowlist::is_allowed_tagged`). Searches/catalogue-gaps never produce a Single.

## Standards

### Coding
- No HTML comments. Arrow functions everywhere. Always `{}` around statements (no one-line `if`).
- Boyscout rule: fix wrong conventions you pass through.
- Split big Vue contexts into components; slim pages, many imports.
- Constants → `helpers/constants.ts`; multi-purpose fns → `helpers/functions.ts`.
- Prefer ternaries over if/return.
- Vue `<script>` order: composables → static vars → refs → watchers → computed → methods.
- **Zero custom CSS** — Tailwind utilities only, no `<style>` blocks. Two exceptions live as `@utility`/global rules in `web/assets/css/main.css`: animated conic-gradient genre border, Leaflet's own classnames. New unrepresentable need → global rule there, never component-local. See `docs/design_system.md`.
- Design tokens (colour/type/radii/shadow) in `web/assets/css/theme.css` (`@theme static`, source of truth, update docs alongside). Reusable Tailwind builders in `web/helpers/ui.ts` (`button()`, `sw()`, `ui.*`) — reuse/extend via `cx()`, promote new one only on 2nd repeat. Status/score colour: single source `helpers/constants.ts` `statuses[]`/`scoreRanges[]` via `toneBg`/`toneText`/`toneFill`.
- Icons: `lucide-vue-next` only. Prisma singleton: `web/server/utils/prisma.ts` only.

### Conventions
- Images via `useImageUrl()`. Types in `web/types/`. No scripts logic in web app (Rust in `/scripts`).
- Metadata is source of truth — never filesystem paths/folder names for artist/album/year.
- Embedded MB IDs are definitive — use directly, no re-verify.
- `/img/*` is public (auth-exempt, artist/release artwork only) — don't assume access-controlled if extending that path.
- Seed admin `admin`/`admin`, `mustChangePassword: true` — don't hardcode a different default or drop the forced change.

### Testing
- Every change needs test coverage considered: run `pnpm test:unit` (+ `pnpm test:e2e` for UI/flow). Untested touched code → add test; stale test → update it.
- `web/test/**/*.test.ts`, `web/e2e/**/*.spec.ts` mirror source path. `vitest.config.ts`: `unit` (happy-dom), `nuxt` (`@nuxt/test-utils`), `integration` (node, testcontainers PG, `fileParallelism:false`). No coverage threshold.
- e2e runs against prod build (`pnpm build` + `node .output/server/index.mjs`); global-setup logs in once. Never let a spec hit `/api/terminal/run` for real — stub it.
- **Always `pnpm test:e2e`, never bare `playwright test`** — `web/.env`'s `DATABASE_URL` is live NAS prod (192.168.1.241). `pnpm test:e2e` runs `e2e/with-test-db.ts` first (disposable testcontainers PG). One-off direct Playwright invocation → export a safe `DATABASE_URL` first.
- New pure logic → importable helper w/ unit test, not buried in store/route (pattern: `server/utils/audioRange.ts`).
- Rust changes need `cd scripts && cargo build --release`; web changes need touched suite green before commit/deploy.

## Scripts

Root shell wrappers over pre-built release binaries — **rebuild after code changes**: `cd scripts && cargo build --release`.

```bash
# Index & Sync
./index                       # Index local files → DB
./sync                        # MB sync (lastIndexedAt > lastSyncedAt)
./refresh                     # index all + sync all pending
./refresh --only "Name"       # refresh one artist
./refresh --release "clxxx"   # re-index+re-sync one release
./index --only "Name" [--exact] [--overwrite] [--overwrite-with-images] [--prune]
./index --resume | --inspect | --folders "Artist/Album" | --release "clxxx"
./index --resolve-artists [--dry-run] [--only "Name"] [--overwrite]  # MB artist-name resolution only, no folder scan
./index --skip-resolve        # skip end-of-run resolution pass
./index --canonicalize-artists [--dry-run]  # reconcile Artist rows vs MB (pure SQL, no network)
./index --delete | --emit-artist-ids f
./sync --only "Name" [--exact] [--overwrite] | --release "clxxx" [--artist-hint "clyyy"]
./sync --delete | --verbose | --skip-mb-tags
./sync --only-write-mb-to-files [--only x]   # backfill MB ids into tags, no API calls
./sync --catalogue-gaps [--overwrite]        # fast MISSING-entry pass
./sync --artist-ids file      # used by refresh
./sync --recompute-scores     # pure SQL, exits
./sync --repair-shared-release-ids [--dry-run]
# boxset::run_repair is automatic (tail of every sync, scoped by --only/--exact), not a flag.

# Audit & Fix
./audit [--corrupted|--orphans|--duplicates|--missing|--enrichment|--duplicate-release|--mismatched-release-id]
./fix [--corrupted|--orphans|--duplicates|--missing]
./fix --revert --corrupted [--mode undo-resolved]   # default mode 'undo' → back to DETECTED

# Destructive
./delete "Artist Name" [--files] [--dry-run]   # cascade delete; "A;B" for multi
./nuke [--keep-artist-img] [--only "Name" [--dry-run]]

# Other
./problems --audit [--only "Name"|--resume|--report-only]     # read-only tag-defect scan → problems.xlsx
./problems --fix:year|--fix:artist|--fix:albumartist [--dry-run]
./extract-meta-images [--dry-run] [--only "Name"]
./artist-photos [--dry-run] [--limit 50]       # backfill artist photos
./analysis /path/to/music     # standalone HTML quality report → reports/
./playlists [--dry-run|--report|--group rock]
./dissect                     # errors.log → reports/errors.xlsx
./backup / ./restore [file.sql.gz]
```

Docs per script in `docs/scripts/`. `mosaic` has no wrapper — invoked by web app (`/api/labs/mosaic/generate`).

Web UI scan buttons run these binaries via `/api/terminal/run`, from **two separate lists** in `helpers/constants.ts`:
- `scanActions` → `components/settings/ScanActions.vue` (library-wide): check new / re-check changed (`--inspect`) / index only / sync only (MANAGER), + ADMIN full re-scan (`--overwrite-with-images` + `sync --overwrite`, never `--prune` library-wide).
- `artistScanActions` → `components/artist/ScanActions.vue` (per-artist): scan new files (MANAGER) / rebuild everything / rebuild files-only / re-match from scratch (ADMIN).

`./delete` takes artist **name** positionally + needs `--y` (stdin prompt, nothing answers it in tmux). `index` scoped by **folders** instead — per-artist actions pass `--folders`, never `--only`: `--only` matches whole top-level directories, and a release co-owned inside another artist's folder (compound albumArtist split) then dragged that artist's entire catalogue into every scan (Michael Jackson → 5 roots, 662 Diana Ross files re-read with `--overwrite` for one duet). `artistScanFolders` (`helpers/artistPageLogic.ts`) mixes granularity, which `index` walks entry by entry (`walk_roots`): own roots — the artist's plus any connected duplicate-merged artist's, matched on `normalize_filter` semantics — go in bare so new albums are still found; every other root contributes only the exact album folders concerned. Trade-off: a **new** co-owned album filed under another artist is found by that artist's scan, not this one. Post-run resolution scopes off touched artist ids, not the filter, so `--folders` keeps it correct. ADMIN gating: `DESTRUCTIVE_FLAGS` in `server/utils/terminalCommand.ts` (`--delete`,`--overwrite*`,`--prune`,`--files`) + `COMMAND_PERM` (puts `./delete`/`./nuke` at ADMIN outright). New destructive flag must be added to the deny-list explicitly.

No UI caller passes `--skip-resolve` — every run does artist-resolution + canonicalize + orphan sweep, scoped by whatever `--only`/`--folders`/`--release` filter it got (`scoped_release_ids_for_filter` never returns `None` once a filter is set).

`Settings → Library` has opt-in auto-scan (`server/utils/autoScan.ts`, ticked by `server/plugins/monitor.ts` on `MONITOR_PRIMARY` only, `runExclusive`-serialized). Off by default, 1h floor interval.

### Fixing wrong artist pages
1. `./audit` → DB  2. `/issues` UI → review/queue  3. `./fix --X`  4. `./refresh --only="..."` (file-writing fixes)  5. re-audit until clean

### Error logs
NAS: `sudo docker exec dmp cat /app/errors.log`

## API Endpoints

**Core**: `GET /api/artists`, `/artists/[slug]`, `/artists/[slug]/releases`, `/artists/[slug]/tracks`, `/artists/random`, `/releases/[id]/tracks`, `/releases/[id]/info`

**Playback**: `GET /api/audio/[id]` (range+ETag), `POST /tracks/[id]/play`, `GET /tracks/[id]/info`, `/tracks/[id]/playlists`, `POST /tracks/explore`, `GET /tracks/random`, `/tracks/random-batch`

**Library**: `GET /releases/latest`, `/releases/last-played`, `/releases/archive`, `/search`, `/timeline/decades`, `/timeline/[decade]`, `POST /timeline/refresh`, `GET /genres`, `/stats`, `/stats/[type]`, `/app-stats`

**CRUD**: `/api/playlists/*`, `/api/favorites/*`, `/api/auth/{login,logout,change-password,me}`, `/api/users/*` (admin), `/api/permissions/*`

**Downloads** (gated `sync.view`/`downloads.crud`): `GET /downloads/{queue,active,status,enabled}`, `POST /downloads/{acquire,merge/[id],merge-all,pause,cleanup,cancel/[id],reject/[id],reject-all,requeue/[id],requeue-all,retry/[id]}`, `GET /artists/monitoring`, `PATCH /artists/[slug]` (toggle `monitored`)

**Issues**: `GET /issues/summary`, `/issues/[type]`, `PATCH /issues/[type]/[id]`, `POST /issues/[type]/queue`, `/issues/[type]/queue-revert`, `GET /issues/history`, `POST /issues/history-undo`, `DELETE /issues/history`

**Settings**: `/api/settings` (GET masked/PUT), `GET /settings/public`

**Scrobble**: `/api/scrobble/connect`, `/callback`, `POST /now-playing`, `/scrobble`

**Labs**: `GET /labs/map/countries` (24h cache), `/labs/map/artists`, `/labs/genome/artists`, `/genome/graph`, `/network/graph`, `/decades/stats`, `/api/labs/mosaic/*`

**Ops**: `POST /api/terminal/run` (SSE, tmux), `/terminal/{stop,reconnect,unlock}`, `GET /scan/status`, `POST /scan/unlock`, `GET /api/health`

## Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard: latest, recently played, playlists, favorites |
| `/browse` | Artist grid, filters, infinite scroll |
| `/artist/[slug]` | Artist detail + releases (aggregated across connected artists) + sync controls |
| `/explore` | 4-slider discovery (energy/era/familiarity/sound) |
| `/playlists`, `/playlists/[slug]` | Playlist library / single playlist |
| `/favorites` | Tabbed releases/tracks |
| `/timeline` | Browse by decade/year |
| `/statistics` (+16 subpages) | Stats dashboard |
| `/downloads` (+5 subpages) | Queue shell: monitoring, merge, queue (`?filter=`), history, events |
| `/labs` (+5 subpages) | map, genome, mosaic, network, decades |
| `/issues`, `/issues/<type>` (7), `/issues/history` | Metadata issue review/fix/undo |
| `/settings/*` (8) | api-keys, downloads, library, monitoring, permissions, scrobble, storage, users |
| `/change-password`, `/login` | Auth |

## Player Store

`stores/player.ts` shuffle modes: `off`/`release`/`artist`/`catalogue`/`explorer`. State persisted to localStorage (queue capped 200).

**Restore read must run in `onMounted`, never inline in `setup()`.** Nuxt Pinia SSR hydration patches every ref back to server-rendered value right after `setup()` returns; an inline (`import.meta.client`-gated) restore gets clobbered back to `null`/`[]` within one tick, and the debounced save watcher then persists that wiped state, corrupting the next restore too. Regression test: `e2e/player-persistence.spec.ts` (must do real `page.reload()` — component-tree unit tests don't round-trip SSR).

## Visualizer

Fullscreen WebGL visualizer over playback. Open: player-bar icon, Explore header, or `v` key; `Esc` exits. 4 fragment-shader presets — **chaos, fractal, julia, buddhabrot** — switchable in HUD or `1`-`4`/`n`. All registered in `helpers/constants.ts`'s `visualizerPresets` (id/label/description/key); adding/renaming a preset touches only that file + its shader/uniform wiring. `decodeVisualizerPreset` falls back to `chaos` for unknown `localStorage['dmp-visualizer']`.

Chaos/Fractal/Julia are all Julia sets, deliberately distinct:
- **Chaos**: `c` searched CPU-side per frame (`helpers/visualizer/juliaPath.ts`) to sit just outside the Mandelbrot boundary (dendrite, not interior blob) — steps along the cardioid's outward normal then bisects an escape-count window (radial cardioid scaling was the original bug — lands inside the period-2 bulb). Camera (zoom/spin) is audio-blind by design (used to jump-scale on kicks — rejected). Colour: CPU hue morph (`helpers/visualizer/hueMorph.ts`, random target every 5-9s) → `uChaosHue` → 3-5 palette anchors (`uChaosPalette`) mixed (not additively layered) by `chaosMix()` in the shared `PRELUDE`, keyed on escape depth/trap proximity. Fractal/Julia/Buddhabrot all reuse this same palette state for visual continuity across preset switches.
- **Fractal**: fixed 6-fold polar-fold kaleidoscope, orbit-trap glow, normalised by viewport height only (extends past L/R edges on wide viewports — not scaled to fit; scattered/tiled variants were tried and reverted). `c` eases between two random points on Chaos's own boundary path over 7-14s. Only preset still reading `uBass` directly — gated through `isBeat()` (`helpers/audioBands.ts`, ratio-over-baseline + absolute floor) so it jumps once per beat after a 5-9s freeze window, not every kick.
- **Julia**: `z <- z^n + c`, `n` drifts between validated targets. Integer-power trick (`zpow()`/`juliaField()`): compute `floor(n)` and `ceil(n)` via repeated complex multiplication (no `atan2`, no branch-cut tearing — the original polar `r^n·(cos nθ,sin nθ)` approach caused visible frame tears) and cross-fade by `fract(n)`. `c`+`n` jointly validated by `helpers/visualizer/juliaField.ts`'s `pickJuliaTarget()` (grid-probes the visible frame — Julia's `z` starts at pixel position, unlike Mandelbrot-style curve search) — a plain live-orbiting `c` (old design) sat in the mostly-interior regime and produced a flat-colour blob. View: `JULIA_VIEW_SCALE=0.35`, `c` radius `[0.75,1.05]`. Target holds 5-12s then eases to next, plain timer (no beat-gating — tried and explicitly removed).

**Buddhabrot** (`helpers/visualizer/buddhabrot.ts`): histogram of *escaping* Mandelbrot orbit trajectories — not a per-pixel function, so render-to-texture + blending + multi-frame GPU state (app's only user of these; `renderer.ts` only calls `resize`/`draw`/`reset`/`dispose`).

**Core invariant: nothing plots until an orbit is proven to escape.** Interior orbits must contribute zero, or the set's void fills in as opaque mush (this was the original bug — a 50-iter Mandelbrot pre-check inside the GPU reseed was nowhere near enough to resolve near-boundary `c`). Fix: `buddhabrotMath.ts`'s `generateSeedPool()` iterates candidates to 2000 steps CPU-side, keeps only those escaping with ≥40-iteration count, and **quantises before verifying** (`quantizeStateValue`/`stateLevel`, JS mirror of the GLSL codec incl. `Math.fround`) so the proven-escaping value is exactly what the GPU iterates. Given that, plotting-as-it-iterates is safe. Seed pool refills a slice/frame (`BUDDHABROT_SEEDS_PER_FRAME`), full turnover ~1s.

Passes/frame: advance (ping-ponged state textures, reseed from pool on escape) → splat (`gl.POINTS`, additive, drawn twice incl. real-axis mirror for free 2x samples — `O(live samples)`, not `O(samples×orbit length)`) → decay (always on, `DECAY_HALF_LIFE_S=2.5s` — short so the image tracks the continuously-drifting sample region instead of blurring into an average) → present (log tonemap + shared `chaosMix()` palette).

Sampled region walks Chaos's boundary path continuously (`BUDDHABROT_SWEEP = JULIA_SWEEP*5`) — a hold-still-then-jump design was tried and rejected (read as a slideshow). Projection must be aspect-corrected (`projectionScale()`) or the silhouette smears. Accumulates into `RGBA32F`/`RGBA16F` where available (`detectFloatSupport()` gates via `EXT_color_buffer_float`/`EXT_float_blend`/`OES_texture_float_linear`) — RGBA8's 256 levels band under decay; `estimateNormalisation()` predicts peak density from elapsed frames + decay (no `readPixels` stall). Audio touches exposure only, never the density field.

`draw()` must leave blending disabled + default framebuffer/viewport restored on every return (only module touching non-default framebuffer/blending). `createBuddhabrotPass()` returns `null` on unsupported GPUs → `renderer.ts` falls back to single-pass Mandelbrot+orbit-trap approximation (same subject/palette, softer, never a black screen); RGBA8+16-bit-fixed-point is a further fallback tier below that.

Misc:
- Web Audio tap is one-shot/permanent: `composables/useAudioAnalyser.ts` module-level `AudioContext`/`MediaElementAudioSourceNode`/`AnalyserNode` singletons — `createMediaElementSource()` throws `InvalidStateError` on 2nd call per element, so no `dispose()`, source must stay connected to `ctx.destination` (else app-wide silence), graph built lazily on first visualizer open.
- `stores/player.ts`'s `getAudioElement()` is `null` until first playback → toggle gated on `player.currentTrack`.
- Overlay is teleported `fixed inset-0`, not `useChrome().hide()` (must stack above Explore cinema mode; `requestFullscreen` needs a real element; iOS Safari rejects it on non-`<video>` hence CSS-only fallback + own Escape handling).
- `prefers-reduced-motion` damped in `Canvas.vue`'s clock — `main.css`'s reduced-motion block can't reach a rAF loop.

## Caching (Redis)

Optional sidecar, falls through to DB silently if unavailable.

| Endpoint | TTL |
|---|---|
| `/api/stats`, `/api/genres`, `/api/timeline/*` | 5 min |
| `/api/artists` | 2 min |
| `/api/artists/[slug]` | 10 min |
| `/api/releases/latest`, `/api/app-stats` | 2 min |
| `/api/releases/last-played` | 1 min |
| `/api/releases/archive` | 5 min |
| `/api/labs/map/countries` | 24 h |

Invalidated on track play (`last-played`, `stats`, `artist:{slug}`) and timeline refresh.

## NAS / Deploy

NAS: `SERVER_HOST` (192.168.1.241), `DEPLOY_PATH` (`/mnt/SSD/web/dmp`), `MUSIC_DIR` (`/mnt/dmp/mainstream`) — all from `web/.env`, not hardcoded.

```bash
./deploy                      # build + transfer + restart
./index --from=e --to=fz      # scripts run directly on NAS copy
./sync --from=e --to=fz
```

## Env Vars

See `web/.env.example`. Scripts-only:
- `MB_MIN_DELAY_MS` — MB inter-request floor for index/sync/problems (default 1100, clamp 1100-10000). Raise only for genuine rate-limiting; doesn't affect MB's silent 503 load-shedding (absorbed, counted in run summary).
- `MB_MAX_INFLIGHT` — concurrent MB requests (default 8, clamp 1-16). **Not a rate knob**: `RateLimiter` is one token schedule issuing 1 request per `MB_MIN_DELAY_MS` however many callers wait, and a clone is a handle onto that *same* schedule (never `RateLimiter::new()` per worker). MB is latency-bound here (cold query ~10s, warm 0.2s), so a serial client reaches ~0.15 of its ~0.91 req/s allowance; in-flight requests reclaim the idle wire, not extra rate. `X-RateLimit-Remaining` is a *shared global* pool (limit 1200/s), never our budget — nothing derived from it may undercut the floor.
