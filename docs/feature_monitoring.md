# Feature: catalogue monitoring & approved downloads

Auto-find releases missing from the library, fetch them from Soulseek into a **staging** area as
**MP3-320**, and only merge them into the real library after a human **approves** — so every
track's origin is always known (pristine vs Soulseek-sourced). Artists can be **monitored**
(Lidarr-style) so this happens continuously and the artist page shows progress in near-real-time.

## Pipeline

```
MusicBrainz catalogue ─► (missing?) ─► slskd search + download ─► transcode MP3-320 ─► STAGING
   ─► DownloadedRelease(PENDING) ─► [user approves] ─► move into MUSIC_DIR ─► index + sync
   ─► LocalRelease.downloadedFrom = 'slskd'
        ▲                                                     artist page shows each hop live:
        └── monitored artists feed this loop automatically    MISSING → Downloading → Verify download
```

Nothing is auto-merged. The human approval gate is the trust boundary, because Soulseek results
are not fully trusted (mislabels, wrong rips, bad quality).

## Steps

1. **Detect missing.** `./sync --catalogue-gaps` compares each artist's MusicBrainz discography to
   what's on disk and marks `MusicBrainzRelease.status = MISSING` (in the catalogue, not local).
   Run on a schedule (cron) — this is the "monitoring".

2. **Auto-download.** `POST /api/downloads/scan-missing` iterates MISSING albums/EPs, **skips**
   anything already local or already queued (a non-rejected `DownloadedRelease`), then runs the
   existing slsk flow: search → best-result pick → enqueue. Capped per run to avoid storms. Can
   also run on a schedule.

3. **Transcode + stage.** When a download completes, its files are moved to
   `DOWNLOADS_PATH/<artist>/<year> - <album>/` and normalized to **MP3 CBR 320** with `ffmpeg`
   (existing ≤320 MP3s are left untouched; tags + cover preserved). A `DownloadedRelease` row is
   written with `status = PENDING`, the Soulseek username, and the source quality.

4. **Approve.** The `/downloads` page lists PENDING items grouped by artist/release with the
   staged files for preview. The user **approves** or **rejects** (reject deletes the staged
   files). An optional global setting `requireApprovalForDownloads` makes *all* downloads — even
   manual per-release ones — pass through this queue.

5. **Promote.** On approval the staged folder is moved `STAGING → MUSIC_DIR` (the `mainstream`
   library). The reconciler runs **scoped to that folder/artist** (`./index --folders …` then
   `./sync --only …`), creating the normal `LocalRelease` / `LocalReleaseTrack` rows. The web layer
   then stamps `LocalRelease.downloadedFrom = 'slskd'`, links the `DownloadedRelease`, and sets its
   `status = PROMOTED`.

## Data model

- **`DownloadedRelease`** — one row per acquisition. Tracks the MISSING target (`mbReleaseId` /
  `releaseGroupId`), `artistId`, `source` (`SLSKD`), `slskUsername`, `quality`, `stagingPath`,
  `status` (`PENDING | APPROVED | REJECTED | PROMOTED | FAILED`), and `localReleaseId` once
  promoted. This is the full audit trail.
- **`LocalRelease.downloadedFrom`** — `NULL` for pristine library files, `'slskd'` for acquired.
  The fast provenance signal used across the UI/queries.

## Per-artist monitoring

Lidarr-style: toggle **Monitor** on an artist page (next to "Scan catalogue") and dmp keeps that
artist complete automatically. Persisted as `Artist.monitored`.

Two background loops (Nitro server plugin `server/plugins/monitor.ts`, in the web container):

| Loop | Default cadence | What it does |
|------|-----------------|--------------|
| Downloads | every 15 min | up to `MONITOR_CAP` (10) MISSING albums/EPs across monitored artists → Soulseek acquire → approval queue |
| Catalogue | every 24 h | `sync --catalogue-gaps --only <artist> --exact` per monitored artist → discovers newly released albums as MISSING |

### Settings → Monitoring tab (live, DB overrides env)
Every knob is editable at **Settings → Monitoring**; a DB value overrides the env default, and
changes apply **without a restart** (read live each tick). Blank a field to fall back to env.

| Setting | Env | Default | Meaning |
|---------|-----|---------|---------|
| Monitoring on/off | `MONITOR_ENABLED` | true | master switch for both loops |
| Download interval (min) | `MONITOR_INTERVAL_MIN` | 15 | download-cycle cadence |
| Per-cycle cap | `MONITOR_CAP` | 10 | max releases queued per cycle |
| Catalogue refresh (h) | `MONITOR_GAPS_HOURS` | 24 | MB catalogue refresh cadence |
| Failed retry cooldown (h) | `MONITOR_RETRY_HOURS` | 12 | wait before retrying a FAILED release |
| No-progress timeout (s) | `NO_PROGRESS_SEC` | 60 | kill a download with no byte progress |
| Max attempts | `MAX_DOWNLOAD_ATTEMPTS` | 3 | attempts before ABANDONED |
| Base tick (s) | `RECONCILE_SEC` | 5 | reconcile cadence (**env only**, needs restart) |

### Release status flow (artist page, near-real-time)

Derived from `DownloadedRelease` — never duplicated into the release tables:

```
MISSING ─► Downloading… ─► Downloaded (pending approval) ─► [approve] ─► normal complete release
               │                    │                          (promote + index/sync)
               ├ FAILED (retry after cooldown) ──┴ [reject] ─► back to MISSING
               └ ABANDONED (gave up after N attempts; auto-retry stops, manual still allowed)
```

### Liveness guarantees (reconciler)
The reconciler runs every base tick (`RECONCILE_SEC`, default 5 s) and is the single owner of
finalization — it reads slskd's real transfer state, so a refresh/poll always reflects reality:
- **No progress for `noProgressSec` (default 60 s) → killed** (transfer cancelled, attempt failed).
  Dead "Queued, Remotely" grabs die in ~1 min instead of clogging the queue.
- **Completed → PENDING** within one tick (~5 s); UI moves it Downloading→Pending and updates counts.
- **Attempt cap**: each failed/no-result attempt increments `attempts`; at `maxDownloadAttempts`
  (default 3) the release becomes **ABANDONED** and is never auto-retried — so impossible
  downloads can't starve the thousands of others. A manual Download from the UI resets the cap.

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
| `MUSIC_DIR` | the real library (`mainstream`) |
| `DOWNLOAD_DIR_TEMPLATE` | staged/promoted folder layout, e.g. `{artist}/{year} - {album}` |
| `DOWNLOAD_FORMATS`, `DOWNLOAD_MIN_BITRATE` | search filters |
| `requireApprovalForDownloads` | route all downloads through the approval queue |

## Safety

Promote only ever **adds new folders** to `MUSIC_DIR`; existing files are never moved or renamed,
so the path-keyed index (`LocalRelease.groupKey` / `folderPath` / `LocalReleaseTrack.filePath`) is
never disturbed. Schema changes deploy with `prisma db push` (this project uses db-push, not
migration files).
