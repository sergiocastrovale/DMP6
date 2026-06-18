# Feature: RuTracker as a second download source (Prowlarr + qBittorrent)

A second acquisition source alongside Soulseek (slskd): **RuTracker**, reached through the NAS's
existing **Prowlarr** (search) and **qBittorrent** (download) — the same *arr stack Lidarr uses.
RuTracker has higher-quality/lossless rips and whole **discography packs**, so when both sources are
enabled **RuTracker is tried first and Soulseek is the fallback**. Everything downstream of "files
landed in staging" (transcode → READY → merge → PROMOTED) is identical to the slsk path
(see [feature_monitoring.md](feature_monitoring.md)).

```
MISSING (MusicBrainz) ─► [RuTracker enabled?] ─► Prowlarr search ─► qBittorrent add PAUSED
   ─► inspect file tree ─► match album folders to MISSING releases ─► download only matched folders
   ─► relocate each album to staging (MP3-320) ─► delete torrent + data ─► READY ─► [merge] ─► PROMOTED
        │
        └─ no match / RuTracker disabled ─► fall through to Soulseek (slskd)
```

## Why Prowlarr + qBittorrent (not raw RT credentials)

RuTracker has no public API and requires a login + can throw captchas. Prowlarr already solves this:
it logs into RuTracker and exposes a normalized search API. So dmp never stores RT credentials — it
stores **Prowlarr** (URL + API key) and **qBittorrent** (URL + user/pass) connection details. The RT
login lives in Prowlarr, exactly as it does for Lidarr.

- **Prowlarr** — searched via `GET /api/v1/search?query=…&type=search&categories=3000` (music),
  optionally restricted to the RuTracker indexer id. Returns torrent results (title, size, seeders,
  magnet/`.torrent` download URL). Client: `web/server/utils/prowlarr.ts`.
- **qBittorrent** — WebUI API v2 (cookie session). Adds torrents, inspects/selects files, polls
  progress, deletes with data. Client: `web/server/utils/qbittorrent.ts`.

## Pack inspection — the key trick

`web/server/utils/acquireTorrent.ts` (`acquireTorrentRelease`) inspects a torrent **before** downloading:

1. Search Prowlarr for `"{artist} {album}"`; iterate the top results by seeders.
2. Add each candidate to qBittorrent **paused/stopped** under category `dmp` + a unique tag (so its
   hash can be discovered). qBittorrent fetches the torrent's metadata but downloads nothing yet.
3. Read the file tree (`/torrents/files`) and group audio files by album folder.
4. Match folders to this artist's MISSING releases (`web/server/utils/torrentMatch.ts`, **moderate**
   strictness: normalized title, year as tiebreaker). **If the triggering release isn't in the torrent,
   delete it and try the next result.**
5. Otherwise download **only** the matched folders (everything else set to file-priority 0) and create
   one `DownloadedRelease` row per matched album — so a discography pack fills **every** MISSING gap it
   covers in a single grab. All rows share the same `torrentHash`.
6. Start the torrent.

## Reconcile + cleanup

`reconcileTorrentDownloads()` (in `web/server/utils/monitorLoop.ts`, fired every base tick next to the
slsk `reconcileDownloads`) handles `source='RUTRACKER'` rows, grouped by `torrentHash`:

- track byte progress; no progress past `NO_PROGRESS_SEC` → delete torrent + fail the group;
- qBittorrent error → delete + fail;
- selected files complete → relocate each album folder into staging (→ READY, or ENRICHING via the
  shared SongKong path), then **delete the torrent + its data**. Torrents never linger.

Cancel/reject of a torrent row also deletes the torrent + data (guarded so a shared pack isn't removed
while a sibling album still needs it). The slsk reconcile is scoped to `source='SLSKD'`, the torrent
reconcile to `source='RUTRACKER'`, so the two never touch each other's rows.

## Source priority + the no-retry rule

The two sources live in the **`DownloadSources`** table (`DownloadSourceConfig` model):

| name | retry | enabled | meaning |
|------|-------|---------|---------|
| `RUTRACKER` | false | switch | tried first; on a miss, **never searched again** for that release |
| `SLSKD` | true  | switch | fallback; retried forever, sinking by `priority` |

Routing (`web/server/utils/downloadSources.ts`, `chooseSource`) uses the existing `priority` field as a
band: fresh picks enter at **priority 10 → RuTracker**. An **RT miss** records `RUTRACKER` in the row's
`triedSources` (the authoritative "never try RT again" guard) and drops the release to **priority 5**,
so the next pick falls through to **Soulseek**. Because the retry pool is ordered `priority DESC`, the
monitor naturally "drains RuTracker first, Soulseek later". A Soulseek miss decrements priority by 1 as
before. **Force retry** resets priority to 10 but keeps `triedSources`, so an exhausted RT source is
never re-searched even on a manual retry.

### Daily search budget

RuTracker's Prowlarr indexer caps searches per day (default **25**). dmp enforces its own budget
(`RT_SEARCHES_PER_DAY`, default **20**) so it stays under the cap — otherwise the monitor's trickle
(~3 searches/min) exhausts the quota in minutes and every search returns an empty (rate-limited) result.
The budget is a rolling 24h window persisted on the `DownloadSources` RUTRACKER row
(`budgetUsed` / `budgetWindowStart`); each `acquireTorrentRelease` spends one unit
(`consumeRtBudget`). When the budget is spent, `chooseSource` skips RuTracker **without** marking it
tried (it wasn't really searched) — the release falls through to Soulseek if enabled, otherwise it
waits for the window to roll over. Raise the budget only after raising the Prowlarr indexer's query
limit (and mind RuTracker's own server-side limits). At 19K-catalogue scale Soulseek stays the
workhorse; RuTracker is a slow, prioritized trickle.

The `/downloads` header **Sources** switches (`components/downloads/DownloadSources.vue`) toggle
`DownloadSources.enabled` per source and show each source's live connection status (RuTracker needs
both Prowlarr + qBittorrent connected; Soulseek needs slskd). The queue tables badge each row with its
actual source (RuTracker / Soulseek), tied to `DownloadedRelease.source`.

## Mount / save path

qBittorrent must save where dmp can relocate the finished files by basename (the same trick slsk uses).
dmp's downloads root is `DOWNLOADS_PATH`; torrents land in its `_torrents` subfolder. Because
qBittorrent may mount the shared volume at a different prefix (e.g. `/downloads`) than dmp, the qBit-side
path is configurable:

- `QBITTORRENT_SAVE_PATH` (default `{DOWNLOADS_PATH}/_torrents`) is passed as the torrent's `savepath`.
- It **must resolve to the same host folder** as `{DOWNLOADS_PATH}/_torrents`. Verify with
  `docker inspect` on the qBittorrent + dmp containers' mounts. uid/gid mismatch is fine: relocation
  copies on `EACCES`/`EPERM`, and `deleteTorrent(deleteFiles=true)` (run as qBittorrent) removes the
  originals.

## Configuration

DB (Settings → Downloads) overrides env; blank a DB field to fall back to env.

| Setting | Env | Purpose |
|---------|-----|---------|
| Prowlarr URL / API key | `PROWLARR_URL`, `PROWLARR_API_KEY` | RuTracker search proxy |
| Indexer id | `PROWLARR_INDEXER_ID` | restrict to the RuTracker indexer (blank = all) |
| qBittorrent URL / user / pass | `QBITTORRENT_URL`, `QBITTORRENT_USER`, `QBITTORRENT_PASS` | torrent download |
| qBittorrent save path | `QBITTORRENT_SAVE_PATH` | qBit-side path mapping to `{DOWNLOADS_PATH}/_torrents` |

Source on/off + retry policy live in the `DownloadSources` table (seeded by `prisma/seed.ts` /
`ensureDownloadSources()`), edited via the header switches or `PUT /api/downloads/sources`.

## Schema (deploy via `prisma db push`)

- `DownloadSource` enum gains `RUTRACKER`.
- New `DownloadSourceConfig` model (`@@map("DownloadSources")`): `name`, `url?`, `retry`, `enabled`.
- `DownloadedRelease` gains `triedSources DownloadSource[]`, `torrentHash`, `torrentFolder`.
- `Settings` gains the Prowlarr/qBittorrent fields above.
