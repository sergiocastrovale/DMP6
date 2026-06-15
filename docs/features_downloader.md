# Downloads

Download missing releases from an artist page via [Soulseek](downloads_slskd.md) (slskd), auto-transcode to MP3-320, optionally enrich with SongKong, and file into a Lidarr-style library layout. This doc is the **full rebuild guide** — everything needed to stand the feature up on a fresh NAS.

## How it works

DMP runs an **always-on, headless acquisition pipeline** (no web UI needed — it lives in a Nitro
server plugin and survives restarts, state in the DB). Monitor artists (one click "Monitor all" for
the whole ~19K catalogue), and DMP continuously fills their missing albums/EPs from Soulseek,
transcodes, enriches, and stages them for a final merge.

Three independent, self-throttled background workers (base tick `RECONCILE_SEC`, default 5s):
- **reconcile** — finalize/fail in-flight downloads; auto-approve finished ones (every tick).
- **topUpDownloads** (Search-Sniper) — keeps up to `MAX_CONCURRENT_DOWNLOADS` active transfers;
  each `SEARCH_INTERVAL_SEC` it randomly picks `SEARCH_PICKS_PER_INTERVAL` MISSING album/EP releases of
  monitored artists (fair across the whole catalogue, skipping handled / recently-failed), searches
  Soulseek, enqueues. Bounded + throttled, so 19K artists never floods slskd.
- **runGapsCycle** — every `GAPS_INTERVAL_MIN`, refresh the MusicBrainz catalogue of `GAPS_PICKS_PER_RUN`
  monitored artists (oldest-checked first, round-robin) so **newly released albums surface as MISSING**
  and get picked up automatically. Cycles the whole catalogue over a few days, MB-rate-friendly.

Manual single grabs still work from an artist page (download icon → dialog), and "Force retry" on the
Downloads page re-queues a failed one immediately.

## Pipeline & folders

```
DOWNLOADING → ENRICHING → PENDING ─(auto-approve, default)─→ APPROVED ─(merge / merge all)─→ PROMOTED
                              └─(auto-approve off)→ manual Approve → APPROVED
```

Two roots, three logical areas (downloads root holds only `dmp/`, `.dmp-songkong/`, `SHARED/`):
```
DOWNLOADS_PATH = /mnt/SSD/Downloads/dmp        staging + _approved subfolder (transient)
  /mnt/SSD/Downloads/dmp/{artist}/…            in-progress: transfer → transcode → enrich → layout
  /mnt/SSD/Downloads/dmp/_approved/…           approved, "Ready to merge" (awaiting merge)
MUSIC_DIR = /mnt/dmp/music/mainstream (/music) merged into the library (index + sync run)   (live)
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
5. **Approve** — auto (default) or manual: moves the release into `DOWNLOADS_APPROVED_FOLDER`
   (status `APPROVED`, shows in the **Ready to merge** tab). No library write yet.
6. **Merge** — manual **Merge** / **Merge all**: moves `APPROVED_FOLDER → MUSIC_DIR` (same layout) +
   runs `index` + `sync` + stamps provenance → `PROMOTED`. This is the only required human step.

The folder transform is **DMP's** (it knows the MB album type); SongKong is enrich-only (never rename/move).

## Downloads page (`/downloads`)

Each tab is its **own page** (mirrors `/issues`: slim pages + a shared `DownloadsShell` =
breadcrumbs + tab bar + persistent header; chrome is the generic `components/TabShell.vue` +
`components/Breadcrumbs.vue`, shared with `/issues`). Tabs: **Monitoring** (`/downloads`, root;
paginated artist list with search + per-artist Turn on/off and a live "Monitoring x/y" counter) ·
**Pending approval** (`/downloads/pending`, manual-approve mode) · **Ready to merge**
(`/downloads/merge`, approved, with Merge / Merge all) · **Downloading** (`/downloads/downloading`,
live % bars + Cancel) · **Failed** (`/downloads/failed`, Force retry / Reject, icon actions) ·
**History** (`/downloads/history`, read-only, subtabs per terminal status: Promoted / Approved /
Rejected / Abandoned). Every queue page has its own client-side search box.
The persistent header (every page) has **Pause all** and **Monitor all / Monitor none** (bulk toggle the whole catalogue; Monitor all goes active
only when every artist is monitored). Per-row **Info** opens the release dialog (folder path, format,
IDs). **Reject** (FAILED or ready-to-merge — same outcome) deletes the staged files and counts toward
`MAX_DOWNLOAD_ATTEMPTS` (default 3): below the cap it returns to FAILED (re-downloadable), at the cap it
becomes terminal `REJECTED` (never auto-re-queued). So the whole try/approve/reject churn is bounded by
N; re-download manually from the artist page to reset.

## Settings

Configurable in `.env` / compose env **and** the Settings DB table (DB wins). UI: **Settings → Monitoring** + **Downloads**.

| Env var | Default | Meaning |
|---------|---------|---------|
| `DOWNLOADS_PATH` | `/mnt/SSD/Downloads/dmp` | Download/staging root (real path, identity-mounted) |
| `DOWNLOADS_DIR` | `/mnt/SSD/Downloads` | Host downloads volume, identity-mounted into web+slskd |
| `DOWNLOADS_APPROVED_FOLDER` | `{DOWNLOADS_PATH}/_approved` | Approved releases staged here until merged |
| `SONGKONG_STATE_DIR` | `/mnt/SSD/Downloads/.dmp-songkong` | SongKong spool/done dir (host cron ↔ dmp) |
| `DOWNLOAD_DIR_TEMPLATE` | `{artist}/{year} - {album}` | Initial staging layout. `{artist}` `{album}` `{year}`; `/` nests, each segment sanitized |
| `DOWNLOAD_FORMATS` | `flac,mp3` | Accepted source formats |
| `DOWNLOAD_MIN_BITRATE` | — | kbps minimum |
| `MONITOR_ENABLED` | `true` | Master switch for the background workers (trickle + gaps + auto-merge) |
| `RECONCILE_SEC` | `5` | Base tick: finalize/auto-approve in-flight downloads (env only, needs restart) |
| `AUTO_APPROVE_DOWNLOADS` | `true` | Auto-move finished downloads to the approved folder (else manual Approve) |
| `AUTO_MERGE` | `false` | Auto-merge approved releases into the library (off = manual Merge gate) |
| `MAX_CONCURRENT_DOWNLOADS` | `5` | Cap on simultaneous active slskd transfers |
| `SEARCH_PICKS_PER_INTERVAL` | `3` | MISSING releases searched per top-up |
| `SEARCH_INTERVAL_SEC` | `60` | Min seconds between top-up runs (throttle) |
| `GAPS_PICKS_PER_RUN` | `20` | Monitored artists catalogue-refreshed per gap run |
| `GAPS_INTERVAL_MIN` | `5` | Minutes between catalogue-gap runs |
| `MONITOR_RETRY_HOURS` | `12` | Cooldown before retrying a FAILED release |
| `NO_PROGRESS_SEC` | `300` | Kill a transfer with no byte progress for this long (lower abandons slow peers) |
| `MAX_DOWNLOAD_ATTEMPTS` | `3` | Attempts before a release is ABANDONED |
| `DOWNLOADS_MIN_FREE_GB` | `5` | Pause new downloads when the downloads volume drops below this |
| `SESSION_SECRET` | — | **Set this** — unset falls back to a public hardcoded dev secret (forgeable sessions) |
| `SONGKONG_ENABLED` | `false` | Run SongKong enrichment before the layout transform |
| `SONGKONG_MAX_WAIT_MIN` | `30` | If SongKong never reports done within this, proceed unenriched |

slskd-specific config: [downloads_slskd.md](downloads_slskd.md).

## Set up on a fresh NAS (copy-paste)

Assumes TrueNAS, shared apps group **gid 568**, downloads on `/mnt/SSD/Downloads`, collection on
`/mnt/dmp/music/mainstream`. Adjust paths per NAS.

**1. Paths & permissions** — the downloads volume is shared by slskd (writes as its uid) and dmp
(moves/deletes), so they need a common group with group-write:
```bash
ssh nas '
  sudo mkdir -p /mnt/SSD/Downloads/dmp/_approved /mnt/SSD/Downloads/.dmp-songkong/spool /mnt/SSD/Downloads/.dmp-songkong/done
  sudo chown -R :568 /mnt/SSD/Downloads/dmp /mnt/SSD/Downloads/.dmp-songkong
  sudo chmod -R 2775 /mnt/SSD/Downloads/dmp          # setgid: new files inherit gid 568
  sudo chmod -R 0777 /mnt/SSD/Downloads/.dmp-songkong
  sudo touch /mnt/SSD/Downloads/.dmp-songkong/{scan,drain}.lock
  sudo chmod 666 /mnt/SSD/Downloads/.dmp-songkong/{scan,drain}.lock'
```

**2. docker-compose.yml** (already in repo) — both `web` and `slskd`:
- identity-mount downloads: `- /mnt/SSD/Downloads:/mnt/SSD/Downloads` (host path == container path).
- `web`: mount collection `- /mnt/dmp/music/mainstream:/music`; **`group_add: ["568"]`** (so dmp can
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

**6. Collection writes** — merges add new folders under `/mnt/dmp/music/mainstream`; dmp (uid 1000,
gid 1001 + 568) can create them. Overwriting a *pre-existing* release owned by another user can `EPERM`
— but truly-missing releases create fresh dmp-owned folders, so normal merges work.

## Scaling & self-management notes

- **Headless & bounded**: download/transcode/enrich/auto-approve run with no UI, capped concurrency,
  throttled trickle, random fairness, and a global in-process lock that serializes all Rust
  `index`/`sync`/`catalogue-gaps` runs (so merges and the gaps worker never collide). Survives restarts.
- **Merge is the one manual step** (unless `AUTO_MERGE=true`). "Merge all" is batched — one `index`
  pass + one `sync` per artist — so a large backlog merges cheaply.
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
ssh nas 'sudo docker logs -f dmp'                                  # reconcile: → ENRICHING / → ready (APPROVED)
ssh nas 'ls /mnt/SSD/Downloads/.dmp-songkong/{spool,done}'         # spool appears, then done marker
ssh nas 'tail -f /tmp/songkong-drain.log'                          # SongKong runs
```

### Gotchas

- **Never** point the scan at the live SongKong config dir — H2 lock deadlock. Always the dedicated `AUTO_CFG` via `docker run --rm`.
- The bundled `songkong_fixsongs_dmp.properties` is already **enrich-only** (no `renameFiles`/`moveFiles` keys). If you swap in your own profile, keep it that way or SongKong will fight DMP's layout.
- BPM/mood stay empty — SongKong's source (AcousticBrainz) is shut down; AcoustID/genres/art/MBID work.
- Drainer down / SongKong stuck → downloads promote unenriched after `SONGKONG_MAX_WAIT_MIN`, never stranded.
- `prisma db push` runs *after* the container restart in `./deploy`, so a few `invalid enum "ENRICHING"` errors in the log during that gap are expected and self-heal.
