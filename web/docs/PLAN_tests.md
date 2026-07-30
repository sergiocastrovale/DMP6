# DMP Web — Test Plan

Enterprise-grade unit, integration, and e2e test suite for the DMP v6 web app (`web/`). This document is the execution spec: work top-to-bottom, phase by phase, keeping `pnpm test` green before advancing. Target coverage is **exhaustive parity** — every route, store, composable, helper, and logic-heavy component gets tests.

## Context

The app is a large Nuxt 4 music library (101 API routes, 37 server utils, 8 Pinia stores, 13 composables, 56 pages, 138 components) and is known to be bug-prone, especially the downloads/merge pipeline, the sync/release-aggregation matcher, the terminal shell-exec surface, and auth. Today only 4 test files exist (`test/audioRange.test.ts`, `test/useMediaSession.test.ts`, `e2e/audio.spec.ts`, `e2e/pwa.spec.ts`). This plan brings the whole app under test using the patterns those files already establish.

## Established conventions to mirror (do not reinvent)

- **Runners already installed**: `vitest@4`, `@vue/test-utils`, `@nuxt/test-utils`, `@playwright/test`, `happy-dom`. Scripts: `test`/`test:unit` = `vitest run`, `test:e2e` = `playwright test`.
- **Unit imports are relative** — vitest does NOT resolve the `~`/`@` Nuxt aliases (see `vitest.config.ts`). Existing tests import `../server/utils/audioRange` etc. Keep this.
- **DI-for-testability pattern** — see `test/useMediaSession.test.ts`: logic takes injected callbacks/fakes instead of reaching for globals. Prefer this when extracting logic.
- **Pure-function extraction pattern** — see `server/utils/audioRange.ts` split out of the audio handler and tested in isolation. This is the model for all "surgical extraction" below.
- **E2E against the production build** — `playwright.config.ts` runs `node .output/server/index.mjs`, auth via `e2e/global-setup.ts` (logs in once, saves `e2e/.auth/state.json`), specs `test.skip(!data)` when the seed lacks rows. Keep this shape.
- **Test file locations**: unit → `test/**/*.test.ts`; e2e → `e2e/**/*.spec.ts`. Mirror the source path inside `test/` (e.g. `test/server/utils/promote.test.ts`, `test/stores/player.test.ts`).

## Test architecture — four layers

| Layer | Runner / env | What it covers | DB / externals |
|---|---|---|---|
| **L1 Pure unit** | vitest, `happy-dom` (or `node`) | helpers, pure server-utils functions, extracted pure logic | none — no I/O |
| **L2 Nuxt unit** | vitest, `nuxt` env (`@nuxt/test-utils`) | stores, composables, logic-heavy components | mock `$fetch`/`navigateTo`/`useRoute` via `mockNuxtImport`; fake timers |
| **L3 Server integration** | vitest, `node` env + real test Postgres | exported server-util logic (`promote`, `autoDownload`, `monitorLoop`, release aggregation, auth), thin handlers via `@nuxt/test-utils` `$fetch` where needed | real Prisma against ephemeral Postgres; fs in tmpdir; external HTTP (slskd/qbit/prowlarr/lastfm) mocked via `vi.mock` of the client util modules |
| **L4 E2E** | Playwright, prod build, seeded DB | full user journeys through the browser | real seeded Postgres, real Nitro server |

Split vitest into **projects** (vitest 4 `test.projects`) so each layer runs in the right environment and can run independently in CI.

## Phase 0 — Infrastructure

**Add dev deps**: `@vitest/coverage-v8`, `@testcontainers/postgresql` (ephemeral Postgres for local + integration), and use `@nuxt/test-utils/config`'s `defineVitestConfig` for the Nuxt project. (No `msw` — external HTTP is mocked at the client-util boundary with `vi.mock`.)

**Restructure vitest config** into projects (replace the single `vitest.config.ts`):
- `unit` — `environment: 'happy-dom'`, `include: ['test/unit/**/*.test.ts', 'test/helpers/**', 'test/server/utils/**']` for pure logic (no Nuxt).
- `nuxt` — `defineVitestConfig({ test: { environment: 'nuxt', include: ['test/stores/**', 'test/composables/**', 'test/components/**'] } })`. Enables `mockNuxtImport`, `mountSuspended`, auto-imports.
- `integration` — `environment: 'node'`, `include: ['test/integration/**']`, `globalSetup: 'test/setup/db.global.ts'`, `fileParallelism: false` (shared DB), longer `testTimeout`.
- Enable `coverage` (v8 provider) with thresholds — start at **lines/functions/statements ≥ 70%, branches ≥ 60%**, ratcheting up as suites land. Exclude `.nuxt/`, `.output/`, `types/`, `prisma/`, config files, `e2e/`.

**Test DB harness** — `test/setup/db.global.ts` + `test/setup/db.ts`:
- `getTestDbUrl()` — prefer `process.env.DATABASE_URL_TEST` (CI sets it via a `postgres` service); otherwise boot a `PostgreSqlContainer` (testcontainers) and export its URL.
- Global setup runs `prisma db push` (schema at `prisma/schema.prisma`) against the test DB, then `prisma db seed` (`prisma/seed.ts`) for the RBAC matrix + `admin`/`admin` user.
- `resetDb()` helper — `TRUNCATE ... RESTART IDENTITY CASCADE` across all tables (or per-suite transactional rollback) between integration tests so cases are isolated.
- Set `MONITOR_PRIMARY` **unset/false** in all integration/e2e setup so `server/plugins/monitor.ts` never starts its acquisition timer.
- Set a fixed `SESSION_SECRET` in test env so `server/utils/auth.ts` tokens are deterministic (never rely on the insecure `dmp-insecure-dev-secret` fallback).

**Factories** — `test/factories/*.ts` (typed builders returning valid rows, overridable): `makeUser`, `makeArtist`, `makeMbRelease` (+ tracks, + `MusicBrainzReleaseArtist`), `makeLocalRelease` (+ tracks, + `LocalReleaseArtist`), `makeDownloadedRelease` (each `DownloadStatus`), `makeTrack`, `makePlaylist`, `makeIssue*`. Use these everywhere instead of inline literals.

**External-service mocking helpers** — `test/setup/mocks/*.ts`: reusable `vi.mock` factories for `slskd.ts`, `qbittorrent.ts`, `prowlarr.ts`, `acquireTorrent.ts`, `lastfm.ts` client functions, returning canned success/failure/partial responses. Filesystem: use real tmpdirs (`fs.mkdtemp`) for move/promote tests so `moveDir`/`copy_file_range` behavior is exercised for real; simulate EXDEV by asserting the cross-device fallback path (or stub `fs.rename` to throw `EXDEV` once).

**CI** — `.github/workflows/test.yml` (currently absent; `playwright.config.ts` already assumes it):
- `services: postgres:16` (health-checked), env `DATABASE_URL_TEST`.
- Steps: checkout → pnpm install → `prisma generate` → `prisma db push` → **unit + integration** (`vitest run --coverage`) → upload coverage → `pnpm build` → `prisma db seed` → **e2e** (`playwright test`, `CI=1`).
- Fail on coverage-threshold miss and on any test failure.

## Phase 1 — Pure unit tests (no I/O, highest ROI, zero setup)

**Helpers** (`test/helpers/functions.test.ts`, `test/helpers/constants.test.ts`):
- `helpers/functions.ts` — one describe per export: `parseProgress` (latest `PROGRESS:{json}` scanned backwards, malformed → null), `filterQueue` (case-insensitive over artist/title/year, empty query passthrough), `sortItems` (nulls sink, numeric vs `localeCompare`, non-mutating), `downloadSubpage` (every state → route mapping incl. default), `formatDuration`/`formatPlaytime` (null/non-finite guards, pluralization, `< 1 minute`), `formatNumber`, `formatDate` (**pin `TZ` and locale `pt-PT`**; null → `Never`), `timeAgo` (**mock `Date.now`**; just now/m/h/d; null → `''`), `formatFileSize` (B→TB, `<10` one decimal, `≤0` → `0 B`), `formatSpeed` (MB/s vs KB/s, falsy → `''`).
- `helpers/constants.ts` — `getScoreRange` boundary tests at 0/20/40/60/80/100 and out-of-range.

**Pure server utils** (`test/server/utils/*.test.ts`):
- `pagination.ts` — `parsePagination` clamping (page/pageSize/skip, min/max, defaults).
- `downloadProgress.ts` — `computeDownloadPercent`: status→percent rules, **BigInt** byte inputs, the **99% cap while DOWNLOADING**, zero/na totals.
- `downloadSettings.ts` — `resolveDownloadDir`: template placeholder rendering, filename sanitization, `{year}` collapse when null, path-segment sanitize, 200-char slice.
- `torrentMatch.ts` — `normalizeTitle` (diacritics/brackets/punct strip), `matchTorrentFolders` (greedy folder→release match, year tiebreaker, no-match).
- `explore.ts` — `scoreTrack` (each of the 4 sliders' contribution + combined), `weightedRandomPick` (**seed `Math.random`**; weight distribution, empty pool), `getPoolCacheKey`; exercise `getCachedPool`/`setCachedPool`/`removeFromPool` with an explicit cache-reset between tests.
- `auth.ts` — **session crypto** (fixed `SESSION_SECRET`): `createSession`→`validateSession` roundtrip; tampered payload rejected; tampered signature rejected; expired `exp` rejected; wrong-length signature rejected before `timingSafeEqual`; `isSessionStaleForUser` true when password hash changed, false otherwise; confirm `userId` type matches `User.id`.
- `lastfm.ts` — `isLastfmConfigured`, `signRequest` (deterministic MD5 signature over sorted params).
- `transcode.ts` — `ext`, `sanitize` (illegal chars, spaces, length).
- `slskd.ts` — `isAudioFile`, `isSlskdTerminal`, `isSlskdFailed` (compound states like `"Completed, Cancelled"`), `stripSlskdSuffix` (strips `_\d{6,}` before extension; **document the false-positive** on a real title ending in `_123456`).
- `qbittorrent.ts` — `isQbitComplete` across qBit states.
- `permissions.ts` — `getPermissionsForRole`, `hasPermission`, `DEFAULT_MATRIX` shape; `requirePermission`/`requireRole` against a faked H3 `event.context.user` (throws 403 when missing, passes when present); reset the module-level cache between tests.
- `downloadSources.ts` — `chooseSource` (RuTracker budget-first vs Soulseek fallback; priority floor `Math.max(0, priority-1)`; RT only when `priority > SLSK_PRIORITY`), `rtBudgetAvailable`/budget-window roll at exactly `DAY_MS`, "refused vs real miss" fork.
- `scriptLock.ts` — `runExclusive` serializes concurrent calls (in-process), releases on throw.

## Phase 2 — Surgical extractions (behavior-preserving) + their unit tests

Each extraction moves pure logic into an importable, relatively-imported module, and the original caller imports it back. Keep diffs minimal; do not change behavior. Then unit-test the new module.

1. **Player pure logic** → `helpers/playerLogic.ts` (out of `stores/player.ts`): `shuffleArray` (Fisher–Yates — seed `Math.random`, assert permutation + in-bounds), `shouldScrobble({duration,currentTime})` (fires when `duration≥30` && (`currentTime>50%` || `>240s`)), `capHistory`/`capSession` arithmetic (50 / 200 caps, dedup), `nextIndexWrap`, and the persistence slice-cap (`QUEUE_PERSIST_CAP=200`). Tests in `test/helpers/playerLogic.test.ts`.
2. **SSE parser** → `helpers/sse.ts` (out of `stores/terminal.ts` and `stores/mosaic.ts`, which duplicate it): `parseSseChunks` handling `\n\n` framing, `event:`/`data:` lines, `done` exit code, and `\r`-prefixed progress line-rewrite. Feed a `ReadableStream` of chunk strings. Tests in `test/helpers/sse.test.ts`.
3. **Terminal command safety** → `server/utils/terminalCommand.ts` (out of `server/api/terminal/run.post.ts`): `isAllowedCommand`, `validateSession` (`^[a-zA-Z0-9_-]{1,32}$`), `escapeArg` (single-quote escaping), `buildScript`, `stripAnsi`, `parseExitLine` (`DMP_EXIT:` slice). **Security-critical** — fuzz `escapeArg`/`buildScript` with embedded single quotes, `$(...)`, backticks, newlines, null bytes, and assert no shell-metacharacter escapes the single-quoted context; assert non-array `args` is rejected. Tests in `test/server/utils/terminalCommand.test.ts`.
4. **Release aggregation core** → `server/utils/releaseAggregation.ts` (out of `server/api/artists/[slug]/releases.get.ts`): a pure function taking `{ localReleases, mbReleases, connectedArtistIds }` and returning `{ localCards, gapCards, appearsOn, coveredMbIds }`. This isolates the **shared-`releaseId`** logic for direct unit testing without a DB. Tests in `test/server/utils/releaseAggregation.test.ts` (see cases in Phase 5).

If any extraction proves too invasive to keep behavior identical, leave the code in place and cover it at L2/L3 instead — note the deviation in the test file header.

## Phase 3 — Stores & composables (Nuxt env, `mockNuxtImport` + fake timers)

**Stores** (`test/stores/*.test.ts`) — use `setActivePinia(createPinia())` per test; mock `$fetch` via `mockNuxtImport('$fetch', ...)`; `vi.useFakeTimers()` for poll loops:
- `toast.ts` — full coverage (pure): push/error/success/info/dismiss, auto-dismiss at 6000ms, id uniqueness.
- `global.ts` — `playtimeHours`/`playtimeMinutes` computeds; `refresh` with mocked fetch.
- `downloads.ts` — the pure getters directly from seeded state (`readyCount`, `activeCount`, `mergingIds` = `mergeInitiated ∪ mergeProgress` keys, `mergeActive`, `hasInFlight`, `queuePollNeeded`, `mergeInFlightCount`, `mergeLabel`, **`mergePercent`** 3-steps-per-item math clamped 0–99); then actions (`checkStatus`, `fetchQueue`, `merge`/`mergeAll`/`mergeSelected`, `setPaused`, `toggleSource`, `cleanupReady`) with mocked fetch + fake timers; assert self-stopping poll loops (`startQueuePolling`/`startMergePolling` stop when idle) and **restart on source-enable**; cross-store routing to terminal when `settings.showTerminal`.
- `player.ts` — action-level with stubbed `HTMLAudioElement` + `navigator.mediaSession` (reuse the fake from `useMediaSession.test.ts`) and mocked `$fetch`: `playTrack`, `togglePlay`, `next`/`previous` across all branches (explorer/catalogue/empty/normal wrap), `cycleShuffleMode` (`off→release→artist→catalogue→off`; **explorer exits to off** and clears explorer state + refetches release), `refillCatalogueBuffer` re-entrancy guard + `<5` refill threshold, `previous` >3s restart vs history-pop, localStorage persistence roundtrip (restores paused at saved position; **explorer coerced to off**; corrupt JSON swallowed; debounce 500ms). Pure bits already covered by `helpers/playerLogic.test.ts` (Phase 2).
- `issues.ts` — `setSort` toggle (asc↔desc, page reset), `patchIssue` optimistic merge + **error path leaves stale edit** (assert the known bug), `queueIds` partial-queue count, history sub-store actions.
- `terminal.ts` — drive via extracted `parseSseChunks`; `hasLockError` computed (`'lock held'` detection); `refresh` on finally.
- `mosaic.ts` — SSE generate stream (`progress`/`result`), `loadMosaics`/`deleteMosaic`.
- `browse.ts` — filter setters mutate then fetch; param assembly in `fetchArtists` (letter/genre/sort/score/search, pageSize 48 vs 250, infinite `loadMore`).
- `settings.ts` — public settings fetch/shape.

**Composables** (`test/composables/*.test.ts`):
- `useArtistCatalogue.ts` — **high value, pure**: `countReleases`, `buildGroups` (bucket by `releaseGroupId || solo:{id}`; null group → each release its own `solo:` group; two editions share a group collapse; `dateKey` fallback `9999-99-99` sorts undated last; `localeCompare` sort stability), `filteredReleases`/`visibleReleases`/`statusCounts` chains.
- `useImageUrl.ts` — `resolve` pure over args (S3 absolute passthrough vs `/img/...` path) with a stubbed settings store.
- `useFormSave.ts` — state machine `saving`/`saved`/`error` + 3s reset (fake timers), success and thrown-error paths.
- `useNativeBridge.ts` — no-ops in browser; calls through with a fake `window.Capacitor`.
- `useReleaseDownloadState.ts` — flag computeds per `downloadState`; `verifyDownload` nav (mock `navigateTo`).
- `useAuth.ts` — `isLoggedIn`/`isAdmin`/`isManager`/`hasPerm` computeds over a seeded `useState('auth:user')`; `login`/`logout`/`loadMe` with mocked `$fetch` + `navigateTo`.
- `useBrowseUrl.ts` — `filterQuery` param mapping; `initFromUrl` (mock `useRoute`/`useRouter`).
- `useDownloadQueueActions.ts` — dialog open/confirm/cancel state machine + action delegation to a mocked downloads store.
- `usePlayRelease.ts` — fetch→build `PlayerTrack[]`→`setQueue`; `isCurrentRelease`/`isReleasePlaying`/`toggleOrPlay` (mocked fetch + player store).
- `useExplorer.ts` — `params` computed; `explore`/`playFromHistory` delegate to player.
- `useHighlightId.ts` — reads `?highlight=`, clears after 4s (route mock + fake timers).
- `useSidebar.ts` — collapse at width ≤720 (mock `useWindowSize`).
- `useMediaSession.ts` — already covered; keep and extend if extraction changes it.

## Phase 4 — Component tests (logic-heavy only, `mountSuspended`)

Mount with `@nuxt/test-utils`'s `mountSuspended`, stub child components where needed, drive interactions, assert emitted events / store calls (mock the store). Target the ~15 stateful components; skip presentational primitives (Skeleton, Logo, LoadingGrid, etc.) except the shared interactive primitives listed:
- `player/AudioPlayer.vue` — transport buttons call the right player actions; progress-bar seek maps click→time; volume/mute; shuffle-mode button cycles; disabled states.
- `player/PlayPauseButton.vue` — play/pause toggle reflects store state.
- `issues/IssueTable.vue` + `issues/TypeContent.vue` (largest, 447 LOC) — sortable headers, pagination, row selection, queue/revert actions, per-type editable fields (corrupted→`proposedValue`, unsplit→`proposedParts`, missing→`proposedValues`; orphans/duplicates none); **enrichment hides queue action**.
- `issues/HistoryContent.vue` — undo/clear selection, cross-type batches.
- `downloads/ApprovalQueue.vue`, `downloads/MonitoringTab.vue`, `downloads/MergeContent.vue` — selection bar, merge/reject/retry/cancel wiring via `useDownloadQueueActions`; **MergeContent shows generic "N failed" toast** (assert the known detail-loss behavior).
- `TrackList.vue` (385) + `artist/ArtistReleases.vue` (337) — row click → play, group expand/collapse, multi-edition auto-unfold (`groupKey = releaseGroupId || solo:{id}`).
- `settings/UsersForm.vue`, `settings/DownloadsForm.vue`, `settings/MonitoringForm.vue` — field binding, validation, save via `useFormSave`, dirty state.
- `RealTimeStatus.vue` — live status rendering from mocked SSE/store.
- `layout/SearchBar.vue` + `layout/SearchDropdown.vue` — query debounce, result navigation, empty state.
- Shared interactive primitives: `ConfirmDialog.vue`, `Dropdown.vue`/`ButtonDropdown.vue`, `Tabs.vue`/`Subtabs.vue`, `Switch.vue`, `InfiniteScroll.vue` — open/close, emit, keyboard where applicable.

## Phase 5 — Server integration (real test Postgres)

Prefer testing the **exported util functions** directly (handlers are thin wrappers). For handlers with real logic, use `@nuxt/test-utils` server `setup` + `$fetch`, or cover via e2e. Each test uses factories + `resetDb()`.

**Downloads pipeline** (`test/integration/downloads/*.test.ts`) — the #1 target, `server/utils/promote.ts` + `monitorLoop.ts` + `autoDownload.ts`:
- `moveToReady` — `year==null` guard purges + FAILED; else staging→`_ready`, status READY.
- `moveIntoLibrary` interrupted-merge recovery — (a) staged gone + library copy present → recovers & re-indexes in place; (b) staged gone + library absent → 409; (c) dev instance where staged path not under ready folder → 409 (the `startsWith(readyPath + sep)` guard).
- `stampMerged` — keeps `releaseId` set AND (`forcedComplete || matchStatus==='COMPLETE'`) → PROMOTED + retire MISSING placeholder; else purge + INVALID/ABANDONED.
- **Duplicate `localReleaseId` on promote (P2002)** — two DownloadedRelease rows resolving to one LocalRelease: second goes PROMOTED **without** the link, does not throw; a *different* unique violation is NOT swallowed (guard the `.includes('localReleaseId')` branch, incl. non-array `meta.target`).
- `mergeManyDownloadedReleases` returns `{merged, errors[]}` — batch keeps 200 while per-row errors accumulate; contrast single `merge/[id]` throwing 422 (assert the detail-surfacing divergence).
- `moveDir` cross-device — simulate `EXDEV`/`EPERM`/`EACCES`/`ENOTEMPTY` → streamed copy file-by-file, unlink source, rmdir; nested recursion; partial-failure leaves half-copied tree (no rollback — assert current behavior).
- `cleanupReadyDownloads` — **unmounted ready root → 409, deletes nothing** (critical safety).
- `cancelDownloadedRelease` — only `deleteTorrent` when no sibling DOWNLOADING/ENRICHING shares the `torrentHash` (discography pack: cancel one, siblings survive).
- `reconcileDownloads` (monitorLoop) — terminal failed transfer state kills whole download (compound `"Completed, Cancelled"`); no-progress watermark stall → cancel stuck yet finalize landed siblings; file-less orphan older than `ORPHAN_MIN` → fail "never enqueued"; grace-window race with `forceRetryDownload`.
- Attempts-cap semantics across `failAttempt`/`stampMerged`/`applyRejectionCap`/`failNoResult` (UNAVAILABLE never abandons); manual acquire resets `attempts:0`; boundary `attempts >= max(1, maxDownloadAttempts)`.
- `acquire.post.ts` guards — no-MB-year → FAILED; in-flight (`DOWNLOADING/ENRICHING/READY/PROMOTED`) → no double-grab; reuse prior FAILED/ABANDONED row + reset cap; `chooseSource` routing.
- RT daily budget — `consumeRtBudget` up-front, `exhaustRtBudget` on shared-cap refusal, `revertRtLimited` does NOT bump attempts/triedSources; window roll at `DAY_MS`; `triedSources` with `retry=false` never re-searched even on force-retry.
- `transcodeDirToMp3320` failure is swallowed → move still "succeeds" (assert the limbo behavior).

**Release aggregation** (`test/server/utils/releaseAggregation.test.ts`, using the Phase-2 extraction) — the shared-`releaseId` systemic bug:
- Two LocalReleases sharing one `releaseId` → assert correct card count / dedup and no double `coveredMbIds`.
- MISSING catalogue gap wrongly suppressed because another artist's LocalRelease claimed the same `releaseId`.
- Connected-artist (`primaryArtistId`) aggregation — releaseIds deduped via `Set`; a release credited to primary + 2 connected artists collapses to one gap card.
- `releaseId` set but `mbById` miss (MB row deleted on promote) → falls to Appears-On with raw local title/year.
- Pagination over heterogeneous local+gap+appears-on list; download-state attached to the paged slice only (gap card on page 2 still gets its badge).
- Play-count/track/fileSize sums (`server/api/artists/[slug].get.ts`) not double-counted across connected artists; **BigInt** fileSize serialization.

**Auth** (`test/integration/auth/*.test.ts`):
- `login.post` — valid creds set `dmp_session` cookie; bad user and bad password both return uniform 401; returns `mustChangePassword`; `secure` only in production.
- **Session non-revocation** — capture token → `logout` → replay cookie on an API call → **still validates until `exp`** (highest-severity finding; assert current behavior and mark it as a documented risk).
- `change-password` — min length 6 (5 rejected, 6 accepted); rotates `ph` so prior tokens go stale (`isSessionStaleForUser`); reissues fresh token.
- `middleware/auth.ts` — public allow-list (`/api/auth/login|logout`, `/api/health`, `/img/*`); no session → API 401, page → redirect `/login`; `mustChangePassword` gates API to the allow-list + forces `/change-password`; already-authed hitting `/login` handling; stale-session cookie deletion.
- **User-enumeration timing** — non-existent user skips bcrypt (fast) vs wrong password runs bcrypt (slow): assert the code path difference (document as a finding).
- `permissions` — `permissions/index.put` updates matrix + `invalidatePermissionCache`; **empty `RolePermission` table → everything 403** (not defaults); per-process cache staleness across instances (document).

**Terminal** (`test/integration/terminal/*.test.ts`) — mock `tmux`/`execSync`/`fs`:
- `run.post` — command allow-list rejection; per-command permission (`./nuke` ADMIN-only, others `sync.view`/`issues.view`); session regex rejection; `--web` auto-append for index/sync/refresh; non-array `args` rejected; `tmuxAvailable()` false → error SSE.
- `stop.post` — kills `scanPid` with no ownership check (stale-PID risk — document); force-clears DB lock.
- `unlock.post` — **any authed user clears the lock, no role check** (VIEWER can clear an admin job — assert + document).
- Lock contention — a merge's `runReconciler` racing a manual `./sync` → `'lock held'` surfaced.

**Audio** (`test/integration/audio.test.ts`) — handler orchestration with a real temp file: 206 partial + `Content-Range`, full 200 fallback, ETag + 304 on `If-None-Match`, NAS-proxy fallback on local `statSync` miss (mock `remoteServerUrl` fetch), missing track → 404, missing `play.view` → 403. (Pure range logic already in `test/audioRange.test.ts`.)

**Images middleware** (`test/integration/images.test.ts`) — **path-traversal guard** (`..`/`/` in filename → bail), disk hit, remote-proxy fallback, immutable Cache-Control; `localImageExists` traversal guard + exists-cache.

**Issues** (`test/integration/issues/*.test.ts`):
- `[type].get` — `VALID_TYPES`; RESOLVED + `FixHistory` join only for `corrupted|unsplit|missing` and `revertedAt:null`; first-artist-only display on multi-artist releases (document); sort allow-list (unknown key → `createdAt`); pagination `hasMore` boundary + status/search combo.
- `queue.post` — only transitions `status:'DETECTED'` (queuing PENDING/RESOLVED no-ops; returned count < requested — partial-queue).
- `[id].patch` — **no status guard** (editing RESOLVED/PENDING corrupts audit record — assert); unvalidated JSON shape for `proposedParts`/`proposedValues`; 422 "No valid fields" path.
- `queue-revert` supports only `corrupted|unsplit|missing`; `enrichment` not in `MODEL_MAP` (cannot queue/revert → 404).
- `history-undo` — mixed-type id batches; ids no longer RESOLVED silently skipped (count reflects).

**Remaining CRUD + read routes (exhaustive parity, shared recipe)** — for each of the ~30 read endpoints (`artists*`, `releases*`, `tracks*`, `genres`, `search`, `stats*`, `app-stats`, `timeline/*`, `labs/*`, `favorites*`, `playlists*`, `settings*`, `permissions`, `users`, `scan*`, `health`) write one integration test asserting: (1) **auth** — 401 unauthenticated (except `/api/health` public); (2) **shape** — matches the `types/` contract; (3) **filter/param** behavior where present; (4) **cache** — with `REDIS_URL` unset the passthrough path returns correct data (and, where invalidation exists, that a mutating call clears it). For write endpoints (`playlists` create/delete/tracks, `favorites` toggle, `tracks/[id]/play` increments count + invalidates `last-played`/`stats`/`artist:{slug}`, `settings.put` invalidates settings cache, `artists/[slug].patch`, `users` create/patch/delete, `scan/unlock`, `scrobble/*`) assert the DB transition + permission enforcement (server-side, since client `middleware/admin.ts` is not security). Drive these from the factories; group by resource file under `test/integration/routes/`.

## Phase 6 — E2E journeys (Playwright, extend `e2e/`)

Reuse `global-setup.ts` cookie auth; `test.skip` when the seed lacks rows; keep it running against the prod build. One spec per journey:
- `auth.spec.ts` (extend) — unauth page → redirect `/login`; `mustChangePassword` user → forced `/change-password`; non-admin hitting an admin page → `/`; admin-only API 403 for lower role (client redirect is not security).
- `browse.spec.ts` — filter by letter/genre/score/search; expanded↔summarized toggle; infinite scroll; **URL query round-trips** (`useBrowseUrl`) across reload.
- `artist.spec.ts` — open artist, expand a release group, play a release; aggregated releases from connected artists render once (no dupes).
- `playback.spec.ts` — play track/release/playlist; next/previous; shuffle-mode cycle; volume/mute; **persistence across reload** (localStorage `dmp-player` restores paused position); scrobble fires (assert `POST` to play/scrobble). (Range/401 already in `audio.spec.ts`.)
- `explore.spec.ts` — move sliders, pick a track, replay from history.
- `playlists.spec.ts` — list, open, create/generate, add track, play.
- `favorites.spec.ts` — toggle favorite, play from favorites table.
- `search.spec.ts` — global search dropdown, navigate to a result.
- `downloads.spec.ts` — seed a READY `DownloadedRelease` + fake files; merge flow (with and without terminal), reject/retry/cancel, bulk select, pause/resume; live poll stops when idle.
- `issues.spec.ts` — per-type table sort/search/paginate, select + queue fix, revert from history.
- `smoke.spec.ts` — every page renders without console error / 500: iterate the 18 `statistics/*`, 6 `labs/*`, 8 `settings/*`, 8 `downloads/*`, 8 `issues/*` routes (labs D3/Leaflet pages are the heaviest — assert canvas/map mounts).

## Phase 7 — Coverage gate & hardening

- Turn on coverage thresholds in the `unit`+`integration` projects; raise toward lines ≥ 85% / branches ≥ 75% as suites complete.
- Run the whole suite 3× to shake out flakes (timers, ordering, DB isolation). Any flaky test gets `vi.useFakeTimers` or explicit awaits — never a bare retry.
- Wire the CI workflow; ensure it fails on threshold miss.

## Security-focused test index (must-have, cross-referenced above)

1. Terminal `escapeArg`/`buildScript` injection fuzz (Phase 2/5).
2. Session non-revocation after logout + insecure-default `SESSION_SECRET` (Phase 5).
3. Path traversal in images middleware + `localImageExists` (Phase 5).
4. Server-side permission enforcement vs client-only `middleware/admin` redirect (Phase 5/6).
5. User-enumeration timing oracle on login (Phase 5).
6. `unlock.post`/`stop.post` missing ownership/role checks (Phase 5).
7. CSRF surface note — state-changing POSTs rely on `sameSite:'lax'` cookie only, no token (document in a `SECURITY_NOTES` block in the auth spec; not a blocker to add tokens here).

## Authoring conventions (apply to every test)

- Relative imports only in unit/integration (no `~`/`@`).
- Deterministic: pin `TZ`, mock `Date.now`, seed `Math.random`, no real network.
- Reset module-level caches between tests: `permissions`, `settingsCache`, `explore` pool, `redis` (leave `REDIS_URL` unset for passthrough).
- Set `MONITOR_PRIMARY` unset/false and a fixed `SESSION_SECRET` in every integration/e2e setup.
- One `describe` per unit; AAA; assert on **DB state transitions**, not thrown errors, for the pipeline code that swallows errors via `.catch(()=>{})`.
- Mirror the source path under `test/`; name files `*.test.ts` (unit/integration) and `*.spec.ts` (e2e).
- Follow project style (CLAUDE.md): arrow functions, braces around statements, no stray comments, Tailwind-only if any fixture markup is needed.

## Verification (how to know it's done)

- `pnpm test:unit` — all unit + integration green; coverage thresholds met (`--coverage`).
- `pnpm build && pnpm test:e2e` — all Playwright journeys green against the prod build with a seeded test DB.
- Suite runs 3× with zero flakes.
- CI workflow green on a clean checkout (Postgres service, build, seed, e2e).
- Every subsystem in Phases 1–6 has at least one test file; the exhaustive-parity checklist (every route/store/composable/helper/logic-heavy component) is fully ticked.

## Phase 8 — Bake testing into the workflow (edit CLAUDE.md)

Add a `### Testing` subsection under `Standards` in the project `CLAUDE.md` so tests are a first-class part of every change, not an afterthought. Keep it terse, matching the surrounding `Coding standards` / `Project conventions` bullet style:

- **Every code change must consider tests.** Before a change is "done": run the relevant suite (`pnpm test:unit`, plus `pnpm test:e2e` for UI/flow changes). If the touched code has no test, add one; if an existing test is now wrong or deprecated, update it in the same change. A behavior change that doesn't touch its tests is incomplete.
- **Where tests live**: unit/integration `web/test/**/*.test.ts` (mirror the source path), e2e `web/e2e/**/*.spec.ts`. Runners: `vitest` + `@nuxt/test-utils` (unit), Playwright against the prod build (e2e). Full architecture and conventions: `web/docs/PLAN_tests.md`.
- **New pure logic** goes in an importable helper/util (relative-imported) with a unit test — do not bury testable logic inside store closures or route handlers (extraction pattern: `server/utils/audioRange.ts`).
- **Rust script changes** still require `cd scripts && cargo build --release`; **web changes** require the touched test suite to pass before commit/deploy.
