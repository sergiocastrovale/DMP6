# Downloads

Download missing releases from an artist page via [Soulseek](downloads_slskd.md) (slskd), auto-transcode to MP3-320, optionally enrich with SongKong, and file into a Lidarr-style library layout. This doc is the **full rebuild guide** — everything needed to stand the feature up on a fresh NAS.

Provenance: the slskd integration (endpoint shapes, search polling, download monitoring, rate limiting)
and the quality-scoring heuristic (format weight + bitrate + peer speed + queue penalty) were modelled
on [SoulSync](https://github.com/Nezreka/SoulSync). Its other sources (Deezer/Tidal/Qobuz/YouTube),
AcoustID fingerprinting and metadata-enrichment workers were deliberately not adopted — DMP has its own
MusicBrainz sync.

## How it works

DMP runs an **always-on, headless acquisition pipeline** (no web UI needed — it lives in a Nitro
server plugin and survives restarts, state in the DB). Monitor artists (one click "Monitor all" for
the whole ~19K catalogue), and DMP continuously fills their missing albums/EPs from Soulseek,
transcodes, enriches, and stages them for a final merge.

> **Only ONE instance runs the loop.** The plugin starts the background workers only when
> `MONITOR_PRIMARY=true` (per-instance, **env-only** — never the shared-DB `MONITOR_ENABLED`). The
> NAS/prod compose sets it; the NAS is the single primary. Any other instance pointed at the same
> shared DB (e.g. a local dev server) stays **UI-only** and does no acquisition. Required because the
> Rust `index`/`sync` binaries share one exclusive DB lock and the in-process serializer (`runExclusive`)
> only orders spawns *within one process* — two instances both running the loop would collide on that
> lock (e.g. a merge's `index` vs. another instance's `catalogue-gaps`). Dev opts in by setting
> `MONITOR_PRIMARY=true` locally only when it should drive the downloader.

Three independent, self-throttled background workers (base tick `RECONCILE_SEC`, default 5s):
- **reconcile** — finalize/fail in-flight downloads; finished ones auto-land in `_ready` (every tick).
- **topUpDownloads** (Search-Sniper) — keeps up to `MAX_CONCURRENT_DOWNLOADS` active transfers;
  each `SEARCH_INTERVAL_SEC` it picks `SEARCH_PICKS_PER_INTERVAL` releases from two pools: **fresh**
  (a MISSING album/EP of a monitored artist never yet attempted — random, fair across the whole
  catalogue) and **retry** (a previously-attempted release ordered by `priority` DESC, at least one
  slot reserved per tick so deprioritized releases keep trickling even while fresh candidates are
  abundant). Searches Soulseek, enqueues. Bounded + throttled, so 19K artists never floods slskd.
- **runGapsCycle** — every `GAPS_INTERVAL_MIN`, refresh the MusicBrainz catalogue of `GAPS_PICKS_PER_RUN`
  monitored artists (oldest-checked first, round-robin) so **newly released albums surface as MISSING**
  and get picked up automatically. Cycles the whole catalogue over a few days, MB-rate-friendly.

Manual single grabs still work from an artist page (download icon → dialog), and "Force retry" on the
Downloads page re-queues a failed one immediately.

## Pipeline & folders

```
SEARCHING → DOWNLOADING → ENRICHING → READY ─(manual merge / merge all)─┬─(MB-matched)──→ PROMOTED
                                                                        └─(unmatched)──→ INVALID
```

A row is created `SEARCHING` the moment it's picked/requested, before the Soulseek search has actually
found anything — it flips to `DOWNLOADING` only once a real slskd match is confirmed and the
transfer starts. Distinguishes "nothing found yet" from "actively transferring" in the UI (Queue page,
artist-page pill); both are the same "in flight, occupying a concurrency slot" state everywhere else.

Finished downloads land in the `_ready` folder automatically (`status = READY`) — there is no
approval step. The only required human action is the merge.

**Merge is a validity gate.** A download is only kept if MusicBrainz can identify it. On merge DMP
reconciles the moved files with a **targeted `sync --release <localReleaseId>`** (non-destructive — it
never touches sibling MISSING placeholders, unlike a per-artist `sync --only`). The matcher links a
release purely via embedded MB tags (`MUSICBRAINZ_ALBUMID` / `MUSICBRAINZ_RELEASEGROUPID`; fuzzy title
matching is disabled), so:
- **Matched** → real edition + tracks + computed status; `LocalRelease.downloadedFrom='slskd'`,
  download → `PROMOTED`, and the now-owned MISSING **group placeholder** is deleted (so the picker
  can't re-pick it — this is what previously caused merged releases to re-download forever).
- **Unmatched** (untagged / unidentifiable) → the files are **meaningless**: the merged folder + its
  `LocalRelease` are deleted, the download → `INVALID` (`attempts+1`, `priority-1`). The group stays
  MISSING so the trickle worker retries it later hoping a properly-tagged copy surfaces; bounded by
  `MAX_DOWNLOAD_ATTEMPTS` → `ABANDONED`. INVALID is retryable (in `pickRetry`) but shown terminal in
  History → Invalid.

**No Soulseek result ≠ failure.** A search miss (from `SEARCHING`) never counts toward
`MAX_DOWNLOAD_ATTEMPTS` — the release goes `UNAVAILABLE` instead of `FAILED`/`ABANDONED`, and its
`priority` (starts at 10, the max)
drops by one. Real download failures (found, then stalled/no files) still decrement `priority` too,
but keep the existing hard `ABANDONED` cap. The top-up picker orders its retry pool by `priority` DESC,
so repeatedly-unavailable releases sink and get re-tried only as room frees up — they're never stuck
or silently dropped, just deprioritized. "Force retry" (failed/unavailable rows on the Queue tab) resets `priority` to
10, a full boost back to the front of the queue.

Two roots, three logical areas (downloads root holds only `dmp/`, `.dmp-songkong/`, `SHARED/`):
```
DOWNLOADS_PATH = /mnt/SSD/Downloads/dmp        staging + _ready subfolder (transient)
  /mnt/SSD/Downloads/dmp/{artist}/…            in-progress: transfer → transcode → enrich → layout
  /mnt/SSD/Downloads/dmp/_ready/…              READY, "Ready to merge" (awaiting merge)
MUSIC_DIR = /mnt/dmp/mainstream (/music) merged into the library (index + sync run)   (live)
```

Steps:
0. **Artist folder up-front** — when a download is enqueued, DMP creates `DOWNLOADS_PATH/{artist}/`
   immediately, so in-flight work is legible on disk before files land.
1. **Move** — slskd owns its dir; DMP waits for the transfer, then moves files into a staging folder
   under `DOWNLOADS_PATH` (`DOWNLOAD_DIR_TEMPLATE`). slskd + dmp share the same real path
   (`/mnt/SSD/Downloads` is identity-mounted into both), so the move is local.
2. **Transcode + rename** — every audio file → MP3-320 (existing MP3s kept), renamed `NN. Track Title.mp3`.
3. **Enrich** (optional, SongKong) — tags get AcoustID/MBID/genres/cover art. Row sits in `ENRICHING`.
4. **Transform** — DMP lays it out by MusicBrainz album type:
   `{artist}/{type}/{year} - {album}/NN. Title.mp3` (multi-disc nests under `CD 01/`, `CD 02/`…).
5. **Ready** — automatic: moves the release into the derived `{DOWNLOADS_PATH}/_ready` folder
   (status `READY`, shows in the **Ready to merge** tab). No library write yet, no approval gate.
6. **Merge** — manual **Merge** / **Merge all**: moves `_ready → MUSIC_DIR` (same layout),
   runs `index --folders` then the targeted `sync --release <id>` validity gate (above) → `PROMOTED`
   if MB-matched, else the files are discarded and the download goes `INVALID`. The only required human
   step.

The folder transform is **DMP's** (it knows the MB album type); SongKong is enrich-only (never rename/move).

## Downloads page (`/downloads`)

Each tab is its **own page** (mirrors `/issues`: slim pages + a shared `DownloadsShell` =
breadcrumbs + tab bar + persistent header; chrome is the generic `components/TabShell.vue` +
`components/Breadcrumbs.vue`, shared with `/issues`). Tabs: **Monitoring** (`/downloads/monitoring`;
paginated artist list with search + per-artist Turn on/off and a live "Monitoring x/y" counter) ·
**Ready to merge** (`/downloads/merge`, READY, with Merge / Merge all; the artist page deep-links here
via an **Awaiting merge** pill → `?highlight=<id>`, hiding the MISSING badge while acquiring) ·
**Queue** (`/downloads/queue`) · **History** (`/downloads/history`, read-only, subtabs per terminal
status: Promoted / Rejected / Abandoned / Invalid).

**Queue is one page for every live row.** Downloading, Failed, Unavailable and Rejected used to be four
sibling pages running four copies of the same table; they are now `Subtabs` on `/downloads/queue`
(All / Downloading / Failed / Unavailable / Rejected, each with its count), and the filter is in the URL
(`?filter=failed`) so deep links and reloads land on the right slice. The four old per-status URLs are
gone outright — no redirect, `/downloads/failed` 404s — and everything that linked to one now links to
the filter instead. The UI
is identical across slices — one search box, one selection bar, one table — and only the **actions**
differ, derived per row from its status rather than from which page you are on
(`helpers/functions.ts`'s `canRetryDownload` / `canCancelDownload` / `canRequeueDownload` /
`canRejectDownload`, consumed by `ApprovalQueue`'s `auto` prop):

| Status | Row actions | Bulk / header |
|--------|-------------|---------------|
| SEARCHING | Cancel (no % bar — nothing transferring yet) | — |
| DOWNLOADING, ENRICHING | Cancel (live % bar) | — |
| FAILED, ABANDONED | Force retry, Reject | Retry / Reject selected, Reject all |
| UNAVAILABLE | Force retry, Reject | Retry / Reject selected, Reject all |
| REJECTED | Move back to queue | Move to queue selected, Move all back to queue |

The bulk bar's verbs come from the selected rows, so a mixed selection on **All** offers only what
applies to it; switching slice clears the selection rather than acting on rows you can no longer see.
The Unavailable slice keeps its explainer paragraph. Failed/Unavailable rows show the attempt count
("unavailable (N tries)" / "gave up (N tries)").
The persistent header (every page) has **Pause all** and **Monitor all / Monitor none** (bulk toggle the whole catalogue; Monitor all goes active
only when every artist is monitored). Per-row **Info** opens the release dialog (folder path, format,
IDs). **Reject** (FAILED, Unavailable, or ready-to-merge — same outcome) deletes the staged files and, for a
download that was actually found-then-failed, counts toward `MAX_DOWNLOAD_ATTEMPTS` (default 3): below
the cap it returns to FAILED (re-downloadable), at the cap it becomes terminal `REJECTED` (never
auto-re-queued). Search misses (`UNAVAILABLE`) never count toward this cap — only `priority` decrements.
So the failed-download churn is bounded by N; re-download manually from the artist page to reset.

## Settings

Configurable in `.env` / compose env **and** the Settings DB table (DB wins). UI: **Settings → Monitoring** + **Downloads**.

| Env var | Default | Meaning |
|---------|---------|---------|
| `DOWNLOADS_PATH` | `/mnt/SSD/Downloads/dmp` | Download/staging root (real path, identity-mounted) |
| `DOWNLOADS_DIR` | `/mnt/SSD/Downloads` | Host downloads volume, identity-mounted into web+slskd |
| `SONGKONG_STATE_DIR` | `/mnt/SSD/Downloads/.dmp-songkong` | SongKong spool/done dir (host cron ↔ dmp) |
| `DOWNLOAD_DIR_TEMPLATE` | `{artist}/{year} - {album}` | Initial staging layout. `{artist}` `{album}` `{year}`; `/` nests, each segment sanitized |
| `DOWNLOAD_FORMATS` | `flac,mp3` | Accepted source formats |
| `DOWNLOAD_MIN_BITRATE` | — | kbps minimum |
| `Settings.downloadsEnabled` | on | Soulseek acquisition on/off (Settings → Downloads); `null` falls back to `DOWNLOADS_ENABLED` |
| `DOWNLOADS_ENABLED` | `true` | Env default for acquisition on/off; DB value wins when set |
| `MONITOR_ENABLED` | `true` | Master switch for the background workers (trickle + gaps + auto-merge), shared via DB |
| `MONITOR_PRIMARY` | `false` | **Per-instance, env only.** Only the instance with this `=true` runs the loop; everything else pointed at the shared DB is UI-only. Set on the NAS compose; leave unset on dev |
| `RECONCILE_SEC` | `5` | Base tick: finalize in-flight downloads to READY (env only, needs restart) |
| `AUTO_MERGE` | `false` | Auto-merge READY releases into the library (off = manual Merge gate) |
| `MAX_CONCURRENT_DOWNLOADS` | `5` | Cap on simultaneous active slskd transfers |
| `SEARCH_PICKS_PER_INTERVAL` | `3` | MISSING releases searched per top-up |
| `SEARCH_INTERVAL_SEC` | `60` | Min seconds between top-up runs (throttle) |
| `GAPS_PICKS_PER_RUN` | `20` | Monitored artists catalogue-refreshed per gap run |
| `GAPS_INTERVAL_MIN` | `5` | Minutes between catalogue-gap runs |
| `NO_PROGRESS_SEC` | `300` | Kill a transfer with no byte progress for this long (lower abandons slow peers) |
| `MAX_DOWNLOAD_ATTEMPTS` | `3` | Attempts before a release is ABANDONED |
| `DOWNLOADS_MIN_FREE_GB` | `5` | Pause new downloads when the downloads volume drops below this |
| `SESSION_SECRET` | — | **Set this** — unset falls back to a public hardcoded dev secret (forgeable sessions) |
| `SONGKONG_ENABLED` | `false` | Run SongKong enrichment before the layout transform |
| `SONGKONG_MAX_WAIT_MIN` | `30` | If SongKong never reports done within this, proceed unenriched |

slskd-specific config: [downloads_slskd.md](downloads_slskd.md).

## Set up on a fresh NAS (copy-paste)

Assumes TrueNAS, shared apps group **gid 568**, downloads on `/mnt/SSD/Downloads`, collection on
`/mnt/dmp/mainstream`. Adjust paths per NAS.

**1. Paths & permissions** — the downloads volume is shared by slskd (writes as its uid) and dmp
(moves/deletes), so they need a common group with group-write:
```bash
ssh nas '
  sudo mkdir -p /mnt/SSD/Downloads/dmp/_ready /mnt/SSD/Downloads/.dmp-songkong/spool /mnt/SSD/Downloads/.dmp-songkong/done
  sudo chown -R :568 /mnt/SSD/Downloads/dmp /mnt/SSD/Downloads/.dmp-songkong
  sudo chmod -R 2775 /mnt/SSD/Downloads/dmp          # setgid: new files inherit gid 568
  sudo chmod -R 0777 /mnt/SSD/Downloads/.dmp-songkong
  sudo touch /mnt/SSD/Downloads/.dmp-songkong/{scan,drain}.lock
  sudo chmod 666 /mnt/SSD/Downloads/.dmp-songkong/{scan,drain}.lock'
```

**2. docker-compose.yml** (already in repo) — both `web` and `slskd`:
- identity-mount downloads: `- /mnt/SSD/Downloads:/mnt/SSD/Downloads` (host path == container path).
- `web`: mount collection `- /mnt/dmp/mainstream:/music`; **`group_add: ["568"]`** (so dmp can
  delete slskd-owned source files); `MUSIC_DIR=/music`; `DOWNLOADS_PATH=/mnt/SSD/Downloads/dmp`.
- `slskd`: `environment: UMASK=0002` (group-writable downloads).

**3. slskd** — `/mnt/SSD/slskd/config/slskd.yml`:
```yaml
directories:
  downloads: /mnt/SSD/Downloads/dmp
```

**4. Env** — set in `web/.env` (and the Settings DB, DB wins): `DOWNLOADS_PATH=/mnt/SSD/Downloads/dmp`,
`SESSION_SECRET=<random>` (mandatory — else sessions are forgeable), plus any non-default knobs from
the table above. Leave `MUSIC_DIR` per environment (NAS `/music`, local dev your own path).

**5. Deploy + enable**:
```bash
./deploy                                          # builds, db push, precreates dirs, restarts web
# SongKong drainer cron (every 2 min) — see docs/downloads_songkong section below
# then in the app: Settings → Downloads/Monitoring, or Downloads page → "Monitor all"
```

**6. Collection writes** — merges add new folders under `/mnt/dmp/mainstream`; dmp (uid 1000,
gid 1001 + 568) can create them. Overwriting a *pre-existing* release owned by another user can `EPERM`
— but truly-missing releases create fresh dmp-owned folders, so normal merges work.

## Scaling & self-management notes

- **Headless & bounded**: download/transcode/enrich/finalize-to-ready run with no UI, capped concurrency,
  throttled trickle, random fairness. An in-process lock (`runExclusive`) serializes all Rust
  `index`/`sync`/`catalogue-gaps` runs **within the primary instance** so merges and the gaps worker
  never collide. Survives restarts.
- **Single primary, cross-instance safety**: the loop only runs where `MONITOR_PRIMARY=true` (see "How
  it works"), so a dev server on the shared DB can't race the NAS on the Rust DB lock. The remaining
  cross-process case — a **manual** terminal `./index`/`./sync`/`./refresh` on the NAS racing the gaps
  tick — is handled gracefully: on lock contention the gaps batch logs + **skips without stamping
  `lastGapsCheckedAt`**, so those artists stay at the front of the round-robin and retry next tick
  (no silently-dropped catalogue check).
- **Background issues are surfaced**: monitor-loop `warn`/`error` lines are persisted to a `MonitorEvent`
  table (shared DB, pruned >7d) and shown in a **"Recent issues"** panel on the Monitoring tab
  (`/downloads`) — so a failed gaps/merge no longer fails silently. API: `GET /api/downloads/monitor-events`.
- **Merge is the one manual step** (unless `AUTO_MERGE=true`). "Merge all" is batched — one `index`
  pass over every folder, then a per-release targeted `sync --release <id>` validity gate (never the
  old destructive per-artist `sync --only`, which deleted+recreated all the artist's MISSING
  placeholders and caused merged releases to be re-downloaded forever). The standalone `./sync`
  catalogue-gaps path also guards against this: `delete_missing_releases_for_artist` won't drop a
  MISSING placeholder still referenced by a `DownloadedRelease`.
- **slskd ↔ dmp permissions**: slskd writes downloads as its own uid. Give slskd + dmp a **shared gid
  with group-write** (slskd `PUID/PGID` + `UMASK=002`) on the downloads volume, or dmp can copy the
  files into place but can't delete the slskd-owned source — they finalize fine (resilient move) but
  orphan source copies accumulate until perms are aligned.
- **Junk/compound artists** (names containing `;`) are excluded from monitor-all, the trickle worker,
  and the gaps worker — they carry thousands of bogus MISSING entries.
- **Global pause + disk-full safety**: a DB-backed pause (`Settings.downloadsPaused`) halts all *new*
  automated work — topUp, gaps, auto-merge — while reconcile keeps finalizing in-flight downloads.
  Toggle it on `/downloads` ("Pause all downloads" ⇄ "Continue all downloads"). When free space drops
  below `DOWNLOADS_MIN_FREE_GB`, it **auto-pauses** (reason `disk-full`, logged, shown as a red banner);
  trying to Continue while still full re-pauses with a 409. Survives restarts.

---

## SongKong setup

The `dmp` container has **no docker socket**, and SongKong's live GUI server holds an exclusive H2 DB lock, so DMP can't run SongKong itself. Instead:

```
dmp finalize → spool/<id>  ──(host cron, every 2m)──→  songkong-drain.sh → songkong-scan.sh
                  ↑                                                          (dedicated SongKong, --rm)
dmp reconcile ──── done/<id> ◄──────────────────────────────────────────────────────┘
```

- **Dedicated, ephemeral** SongKong (`docker run --rm`) with its **own** config dir → never collides with the live server or any other SongKong instance (each needs its own H2 DB).
- **Enrich-only** profile (no rename/move) — DMP owns the layout. The profile is **bundled in the repo** (`songkong_fixsongs_dmp.properties`), deployed next to the scripts, and copied into the dedicated config at scan time — a fresh NAS needs **no GUI profile setup**. (If the bundled file is ever missing, the scan script falls back to discovering a profile named `BPM, AcousticID, Genres, images` in the live GUI config, then to SongKong's default.)
- Spool/done markers are files under `DOWNLOADS_PATH/.dmp-songkong/`, visible to both the dmp container and the host cron (no HTTP, restart-safe, idempotent).
- Only the **license** is host-specific (per-user secret) — it's read from `<LIVE_CFG>/Prefs/license.properties`; everything else is reproducible from the repo.

### Values to set per NAS

These live in `scripts/monitor/songkong-scan.sh` (top of file) and `scripts/monitor/songkong-drain.sh`:

| Var (scan.sh) | This NAS | Meaning |
|---------------|----------|---------|
| `DL_HOST` | `/mnt/SSD/Downloads` | Host path of `DOWNLOADS_PATH`; mounted into SongKong as `/downloads` |
| `LIVE_CFG` | `/mnt/SSD/songkong` | Live SongKong config — used for the **license** (and as profile fallback) |
| `AUTO_CFG` | `/mnt/SSD/songkong-auto-dmp` | Dedicated config/DB for DMP enrichment (auto-created) |
| `BUNDLED_PROFILE` | `<scripts dir>/songkong_fixsongs_dmp.properties` | Repo-bundled enrich-only profile (preferred; auto-deployed) |
| `WANT_PROFILE` | `BPM, AcousticID, Genres, images` | `profileName=` used only for the live-config fallback lookup |
| `STATE` (drain.sh) | `$DL_HOST/.dmp-songkong` | Spool/done/locks dir |

### Rebuild steps (fresh NAS)

1. **Prereqs**
   - slskd running and reachable (see [downloads_slskd.md](downloads_slskd.md)); `SLSKD_URL` / `SLSKD_API_KEY` set.
   - SongKong container running with a **valid license** at `<LIVE_CFG>/Prefs/license.properties`. No GUI profile needed — the enrich-only profile ships in the repo (`songkong_fixsongs_dmp.properties`) and is applied automatically.
   - dmp + slskd share the downloads volume; the deploy `.env` sets `DOWNLOADS_DIR`, `MUSIC_DIR`, `DEPLOY_PATH`, `SERVER_HOST`/`SERVER_USER`.

2. **Adapt the scripts** (only if your paths differ) — edit `DL_HOST`, `LIVE_CFG`, `AUTO_CFG` in `scripts/monitor/songkong-scan.sh` and `STATE` in `scripts/monitor/songkong-drain.sh`.

3. **Deploy** — ships both scripts + the bundled profile to `DEPLOY_PATH/scripts/monitor/`, pre-creates the spool dirs + locks, runs `prisma db push` (adds the `songkongEnabled` setting + `ENRICHING` status):
   ```bash
   ./deploy
   ```

4. **Create the drainer cron** (every 2 min, root). TrueNAS:
   ```bash
   ssh nas 'sudo midclt call cronjob.create "{\"user\":\"root\",\"command\":\"/bin/sh /mnt/SSD/web/dmp/scripts/monitor/songkong-drain.sh >> /tmp/songkong-drain.log 2>&1\",\"description\":\"DMP: drain SongKong enrichment spool\",\"enabled\":true,\"stdout\":false,\"stderr\":false,\"schedule\":{\"minute\":\"*/2\",\"hour\":\"*\",\"dom\":\"*\",\"month\":\"*\",\"dow\":\"*\"}}"'
   ```
   (Plain crontab equivalent: `*/2 * * * * /bin/sh /mnt/SSD/web/dmp/scripts/monitor/songkong-drain.sh >> /tmp/songkong-drain.log 2>&1`)

5. **Enable** — Settings → Monitoring → "SongKong enrichment" = On, or set `SONGKONG_ENABLED=true`, or directly:
   ```bash
   ssh nas 'sudo docker exec dmp node -e "const{PrismaClient}=require(\"@prisma/client\");const p=new PrismaClient();p.settings.upsert({where:{id:\"main\"},update:{songkongEnabled:true},create:{id:\"main\",songkongEnabled:true}}).then(()=>p.\$disconnect()).then(()=>process.exit(0))"'
   ```

### Verify

```bash
# 1. drainer no-ops on empty spool
ssh nas 'sudo sh /mnt/SSD/web/dmp/scripts/monitor/songkong-drain.sh; echo exit=$?'        # exit=0

# 2. scan guard refuses paths outside /downloads
ssh nas 'sudo sh /mnt/SSD/web/dmp/scripts/monitor/songkong-scan.sh /music/x; echo exit=$?' # REFUSING…, exit=1

# 3. dedicated SongKong actually launches (enrich-only; tags only, no rename) on a real album
ssh nas 'sudo sh /mnt/SSD/web/dmp/scripts/monitor/songkong-scan.sh "/downloads/SOME ALBUM"' # → "Songs saved", "Completed", exit=0

# 4. live flow — trigger a download, watch it walk the pipeline
ssh nas 'sudo docker logs -f dmp'                                  # reconcile: → ENRICHING / → READY
ssh nas 'ls /mnt/SSD/Downloads/.dmp-songkong/{spool,done}'         # spool appears, then done marker
ssh nas 'tail -f /tmp/songkong-drain.log'                          # SongKong runs
```

### Gotchas

- **Never** point the scan at the live SongKong config dir — H2 lock deadlock. Always the dedicated `AUTO_CFG` via `docker run --rm`.
- The bundled `songkong_fixsongs_dmp.properties` is already **enrich-only** (no `renameFiles`/`moveFiles` keys). If you swap in your own profile, keep it that way or SongKong will fight DMP's layout.
- BPM/mood stay empty — SongKong's source (AcousticBrainz) is shut down; AcoustID/genres/art/MBID work.
- Drainer down / SongKong stuck → downloads promote unenriched after `SONGKONG_MAX_WAIT_MIN`, never stranded.
- `prisma db push` runs *after* the container restart in `./deploy`, so a few `invalid enum "ENRICHING"` errors in the log during that gap are expected and self-heal.
