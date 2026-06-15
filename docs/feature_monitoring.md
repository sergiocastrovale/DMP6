# Feature: catalogue monitoring & approved downloads

Auto-find releases missing from the library, fetch them from Soulseek into a **staging** area as
**MP3-320**, and only merge them into the real library after a human **approves** — so every
track's origin is always known (pristine vs Soulseek-sourced). Artists can be **monitored**
(Lidarr-style) so this happens continuously and the artist page shows progress in near-real-time.

## Pipeline

```
MusicBrainz catalogue ─► (missing?) ─► slskd search+download ─► MP3-320 ─► enrich ─► layout ─► STAGING
   ─► DownloadedRelease ─(auto-approve, default)─► APPROVED (approved folder, "Ready to merge")
   ─► [user merges] ─► move into MUSIC_DIR ─► index + sync ─► LocalRelease.downloadedFrom = 'slskd'
        ▲
        └── monitored artists feed this loop automatically, headless (no web UI needed)
```

Designed to run **always-on at full-catalogue scale** (~19K artists): bounded concurrency, throttled
trickle search, random fairness. The **merge** step is the human gate (Soulseek results aren't fully
trusted); approval can be automatic, but nothing enters the library until you merge.

## Steps

1. **Detect missing.** The catalogue-gap worker runs `sync --catalogue-gaps` on a rotating batch of
   monitored artists, marking `MusicBrainzRelease.status = MISSING`. New releases surface continuously.
2. **Auto-download.** `topUpDownloads` keeps `MAX_CONCURRENT_DOWNLOADS` active transfers, randomly
   picking MISSING albums/EPs of monitored artists (skips handled / recently-failed), search → enqueue.
3. **Transcode + enrich + layout.** On completion: move to `DOWNLOADS_PATH`, MP3-320, rename
   `NN. Title.mp3`, optional SongKong enrich, then lay out `{artist}/{type}/{year} - {album}/…`.
4. **Approve.** Auto (default, `AUTO_APPROVE_DOWNLOADS`) or manual: the release moves into
   `DOWNLOADS_APPROVED_FOLDER` and shows in the **Ready to merge** tab (`status = APPROVED`).
5. **Merge.** **Merge** / **Merge all** moves `APPROVED_FOLDER → MUSIC_DIR`, runs `./index --folders …`
   + `./sync --only …`, stamps `LocalRelease.downloadedFrom = 'slskd'`, sets `status = PROMOTED`.
   Reject anywhere (FAILED or APPROVED — identical) deletes the staged files and counts against the
   shared attempt cap: below `MAX_DOWNLOAD_ATTEMPTS` it goes back to FAILED (re-downloadable after the
   cooldown); at the cap it becomes `REJECTED` (terminal, never auto-re-queued). Manual download from
   the artist page resets the cap.

## Data model

- **`DownloadedRelease`** — one row per acquisition. Tracks the MISSING target (`mbReleaseId` /
  `releaseGroupId`), `artistId`, `source` (`SLSKD`), `slskUsername`, `quality`, `stagingPath`,
  `status` (`DOWNLOADING | ENRICHING | PENDING | APPROVED | REJECTED | PROMOTED | FAILED | ABANDONED`;
  APPROVED = in the approved folder/Ready-to-merge, PROMOTED = merged into the library, REJECTED =
  user-rejected at the attempt cap, terminal), and `localReleaseId` once merged. Reject bumps
  `attempts` and keeps the row (FAILED below the cap, REJECTED at it) — never silently deleted. This is
  the full audit trail.
- **`LocalRelease.downloadedFrom`** — `NULL` for pristine library files, `'slskd'` for acquired.
  The fast provenance signal used across the UI/queries.

## Monitoring & the three workers

Toggle **Monitor** on an artist page, or use the **Monitoring** tab (first tab) on `/downloads`:
a paginated, name-searchable list of every artist (50/page, infinite scroll) with a per-artist
**Turn on / Turn off** action and a live "Monitoring x/y artists" counter. The header also has
**Monitor all / Monitor none** to flip the whole catalogue in one `updateMany` (Monitor all shows its
active/yellow state only when *every* artist is monitored). Persisted as `Artist.monitored`. Everything
runs headless in the Nitro server plugin `server/plugins/monitor.ts` (web container) — no browser needed.

One base tick (`RECONCILE_SEC`, default 5s) fires three **independent, self-guarded, self-throttled**
workers (none awaited together, so a slow search can't block finalization):

| Worker | Pacing | What it does |
|--------|--------|--------------|
| `reconcileDownloads` | every tick | finalize/fail in-flight downloads; auto-approve finished ones |
| `topUpDownloads` | every `SEARCH_INTERVAL_SEC` (60s) | keep ≤ `MAX_CONCURRENT_DOWNLOADS` (5) transfers; randomly pick `SEARCH_PICKS_PER_INTERVAL` (3) MISSING album/EP of monitored artists → search → enqueue |
| `runGapsCycle` | every `GAPS_INTERVAL_MIN` (5m) | refresh `GAPS_PICKS_PER_RUN` (20) monitored artists' MB catalogue (oldest `lastGapsCheckedAt` first) so new releases become MISSING |

The download cap + reconcile form a control loop: finished/killed transfers free slots → next top-up
refills. Fairness at 19K comes from random selection + round-robin gap refresh, so load stays flat
regardless of pool size.

**Reliability at scale:** all Rust `index`/`sync`/`catalogue-gaps` runs go through one in-process lock
(`runExclusive`), so the gaps worker and merges never collide on the binaries' exclusive DB lock.
Junk/compound artists (names with `;`) are excluded everywhere. The relocate step finalizes even when
slskd-owned source files can't be deleted (align slskd↔dmp gid + `UMASK=002` to clean those up).
Optional `AUTO_MERGE` (default off) batch-merges approved releases hands-off via a fourth worker
(`runAutoMergeCycle`).

**Logging:** every monitoring error, warning and notice goes through one sink
(`server/utils/monitorLog.ts`) → appended to `monitor.log` at the project root and mirrored to
stdout, all in the fixed format `[{timestamp}][{level}] {message}` (`level` = `error | warn | notice`).
Tail it with `tail -f monitor.log` (or, on the NAS, `sudo docker exec dmp tail -f /app/monitor.log`).

### Settings → Monitoring tab (live, DB overrides env)
Editable at **Settings → Monitoring**; DB value overrides env, changes apply **without restart** (read
live each tick). Blank a field to fall back to env.

| Setting | Env | Default | Meaning |
|---------|-----|---------|---------|
| Monitoring on/off | `MONITOR_ENABLED` | true | master switch for the workers |
| Max concurrent downloads | `MAX_CONCURRENT_DOWNLOADS` | 5 | simultaneous active transfers |
| Search picks per interval | `SEARCH_PICKS_PER_INTERVAL` | 3 | new MISSING searched per top-up |
| Search interval (s) | `SEARCH_INTERVAL_SEC` | 60 | min between top-up runs |
| Gap picks per run | `GAPS_PICKS_PER_RUN` | 20 | artists catalogue-refreshed per gap run |
| Gap interval (min) | `GAPS_INTERVAL_MIN` | 5 | between catalogue-gap runs |
| Auto-approve | `AUTO_APPROVE_DOWNLOADS` | true | finished → approved folder automatically |
| Auto-merge | `AUTO_MERGE` | false | approved → library automatically (off = manual merge gate) |
| Failed retry cooldown (h) | `MONITOR_RETRY_HOURS` | 12 | wait before retrying a FAILED release |
| No-progress timeout (s) | `NO_PROGRESS_SEC` | 300 | kill a download with no byte progress (lower abandons slow peers) |
| Min free space (GB) | `DOWNLOADS_MIN_FREE_GB` | 5 | pause top-ups when the downloads volume is below this |
| Max attempts | `MAX_DOWNLOAD_ATTEMPTS` | 3 | attempts before ABANDONED |
| Base tick (s) | `RECONCILE_SEC` | 5 | reconcile cadence (**env only**, needs restart) |

### Release status flow (artist page, near-real-time)

Derived from `DownloadedRelease` — never duplicated into the release tables:

```
MISSING ─► Downloading… ─► (enriching) ─► Ready to merge (APPROVED) ─► [merge] ─► complete release
               │                                                          (move + index/sync)
               ├ FAILED (retry after cooldown) ◄─┤ [reject below cap] (re-downloadable)
               ├ REJECTED (reject at attempt cap; terminal, manual download re-acquires)
               └ ABANDONED (gave up after N attempts; auto-retry stops, Force retry still works)
```

### Liveness guarantees (reconciler)
The reconciler runs every base tick (`RECONCILE_SEC`, default 5 s) and is the single owner of
finalization — it reads slskd's real transfer state, so a refresh/poll always reflects reality:
- **No progress for `noProgressSec` (default 60 s) → killed** (transfer cancelled, attempt failed).
  Dead "Queued, Remotely" grabs die in ~1 min instead of clogging the queue.
- **Completed → PENDING** within one tick (~5 s); UI moves it Downloading→Pending and updates counts.
- **Attempt cap**: each failed/no-result attempt increments `attempts`; at `maxDownloadAttempts`
  (default 3, `MAX_DOWNLOAD_ATTEMPTS`, DB-overridable) the release becomes **ABANDONED** and is never
  auto-retried, so impossible downloads can't starve the thousands of others. Reject counts toward the
  same `attempts` cap (FAILED below it, REJECTED at it), so the whole try/approve/reject churn is
  bounded by N — a release the user keeps rejecting stops being re-downloaded after N. A manual Download
  from the UI resets the cap.

- The artist page polls a lightweight `GET /api/artists/<slug>/download-status` (5 s) and merges
  the state into the release cards; badges update without reload.
- **Downloaded** rows show a **Verify download** action → `/downloads?highlight=<id>` (right tab
  auto-selected, row scrolled into view and highlighted).
- Approving promotes the files into the library; the artist page detects the transition and
  refreshes, so the release renders like any other complete release (`downloadedFrom='slskd'`).
- Manual downloads (per-release dialog) honor the result you pick and go through the same queue —
  every path converges in `DownloadedRelease`.

## Provenance / trust

- Pristine catalogue release → `LocalRelease.downloadedFrom IS NULL`.
- Soulseek-sourced release → `downloadedFrom = 'slskd'`, with the complete history (source,
  username, quality, timestamps) in `DownloadedRelease`.
- Query "show me everything that came from Soulseek":
  `SELECT * FROM "LocalRelease" WHERE "downloadedFrom" = 'slskd'`.

## Configuration

Set via the Settings UI (DB) or `.env` (DB wins, env is fallback):

| Setting | Purpose |
|---------|---------|
| `SLSKD_URL`, `SLSKD_API_KEY` | slskd connection |
| `DOWNLOADS_PATH` | staging area (NOT the library) |
| `DOWNLOADS_APPROVED_FOLDER` | approved releases await merge here (default `{DOWNLOADS_PATH}/_approved`) |
| `MUSIC_DIR` | the real library (`mainstream`) |
| `DOWNLOAD_DIR_TEMPLATE` | initial staging layout, e.g. `{artist}/{year} - {album}` |
| `DOWNLOAD_FORMATS`, `DOWNLOAD_MIN_BITRATE` | search filters |
| `AUTO_APPROVE_DOWNLOADS` | auto-move finished downloads to the approved folder (else manual approve) |

See [features_downloader.md](features_downloader.md) for the full env table, the Downloads-page tabs,
and SongKong setup.

## Safety

Promote only ever **adds new folders** to `MUSIC_DIR`; existing files are never moved or renamed,
so the path-keyed index (`LocalRelease.groupKey` / `folderPath` / `LocalReleaseTrack.filePath`) is
never disturbed. Schema changes deploy with `prisma db push` (this project uses db-push, not
migration files).
