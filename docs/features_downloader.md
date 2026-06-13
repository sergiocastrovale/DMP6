# Downloads

Download missing releases from an artist page via [Soulseek](downloads_slskd.md) (slskd), auto-transcode to MP3-320, optionally enrich with SongKong, and file into a Lidarr-style library layout. This doc is the **full rebuild guide** — everything needed to stand the feature up on a fresh NAS.

## How it works

- Each not-in-library release on an artist page shows a download icon → dialog to search Soulseek and pick a result. "Download missing" grabs every missing release in the current view.
- Downloads run in the background (live progress in the side panel) and land in an **approval queue** (`/downloads`). Approve to promote into the library.

## Pipeline

A finished transfer is driven by the reconcile loop (server plugin, ticks every `RECONCILE_SEC`s) through these statuses:

```
DOWNLOADING → ENRICHING → PENDING → (approve) → PROMOTED
```

1. **Move** — slskd owns its download dir; DMP waits for the transfer, then moves files into a staging folder under `DOWNLOADS_PATH` from `DOWNLOAD_DIR_TEMPLATE` (`{artist}/{year} - {album}`). Requires slskd's downloads to be reachable under `DOWNLOADS_PATH` (default: both containers share `/downloads`), else the move no-ops.
2. **Transcode + rename** — every audio file → MP3-320 (existing MP3s kept), renamed `NN. Track Title.mp3` from its track/title tags.
3. **Enrich** (optional, SongKong) — AcoustID / MusicBrainz IDs / genres / cover art written into tags. Row sits in `ENRICHING`. See [SongKong setup](#songkong-setup).
4. **Transform** — DMP reads the (enriched) tags + the MusicBrainz album type and lays the release out as:

```
DOWNLOADS_PATH/
└── Radiohead/
    └── Album/                  ← MusicBrainz release type
        └── 2007 - In Rainbows/
            ├── 01. 15 Step.mp3
            └── CD 01/…         ← multi-disc only: tracks nest under CD 01/, CD 02/, …
```

5. **PENDING** — ready for approval. On approval DMP moves the staged folder into `MUSIC_DIR` (same `{artist}/{type}/{year} - {album}` layout) and runs `index` + `sync`.

The folder transform is done by **DMP**, not SongKong — only DMP knows the MusicBrainz album type for the `{type}` folder. SongKong is enrich-only (must never rename/move).

## Settings

Configurable in `.env` / compose env **and** the Settings DB table (DB wins). UI: **Settings → Monitoring** + **Downloads**.

| Env var | Default | Meaning |
|---------|---------|---------|
| `DOWNLOADS_PATH` | — | Staging root (container view, e.g. `/downloads`) |
| `DOWNLOAD_DIR_TEMPLATE` | `{artist}/{year} - {album}` | Initial staging layout. `{artist}` `{album}` `{year}` (year drops with its ` - ` padding if unknown); `/` nests folders, each segment sanitized |
| `DOWNLOAD_FORMATS` | `flac,mp3` | Accepted source formats |
| `DOWNLOAD_MIN_BITRATE` | — | kbps minimum |
| `SONGKONG_ENABLED` | `false` | Run SongKong enrichment before the layout transform |
| `SONGKONG_MAX_WAIT_MIN` | `30` | If SongKong never reports done within this, promote unenriched (never strand) |

slskd-specific config: [downloads_slskd.md](downloads_slskd.md).

---

## SongKong setup

The `dmp` container has **no docker socket**, and SongKong's live GUI server holds an exclusive H2 DB lock, so DMP can't run SongKong itself. Instead:

```
dmp finalize → spool/<id>  ──(host cron, every 2m)──→  dmp-songkong-drain.sh → dmp-songkong-scan.sh
                  ↑                                                              (dedicated SongKong, --rm)
dmp reconcile ──── done/<id> ◄──────────────────────────────────────────────────────┘
```

- **Dedicated, ephemeral** SongKong (`docker run --rm`) with its **own** config dir → never collides with the live server or any other SongKong instance (each needs its own H2 DB).
- **Enrich-only** profile (no rename/move) — DMP owns the layout.
- Spool/done markers are files under `DOWNLOADS_PATH/.dmp-songkong/`, visible to both the dmp container and the host cron (no HTTP, restart-safe, idempotent).

### Values to set per NAS

These live in `dmp-songkong-scan.sh` (top of file) and `dmp-songkong-drain.sh`:

| Var (scan.sh) | This NAS | Meaning |
|---------------|----------|---------|
| `DL_HOST` | `/mnt/SSD/Downloads` | Host path of `DOWNLOADS_PATH`; mounted into SongKong as `/downloads` |
| `LIVE_CFG` | `/mnt/SSD/songkong` | Live SongKong config (license + saved profiles) |
| `AUTO_CFG` | `/mnt/SSD/songkong-auto-dmp` | Dedicated config/DB for DMP enrichment (auto-created) |
| `WANT_PROFILE` | `BPM, AcousticID, Genres, images` | `profileName=` of the enrich-only FixSongs profile |
| `STATE` (drain.sh) | `$DL_HOST/.dmp-songkong` | Spool/done/locks dir |

### Rebuild steps (fresh NAS)

1. **Prereqs**
   - slskd running and reachable (see [downloads_slskd.md](downloads_slskd.md)); `SLSKD_URL` / `SLSKD_API_KEY` set.
   - SongKong container running with a **valid license** at `<LIVE_CFG>/Prefs/license.properties` and a saved **enrich-only** FixSongs profile (in its GUI: Rename Files OFF). Note its `profileName`.
   - dmp + slskd share the downloads volume; the deploy `.env` sets `DOWNLOADS_DIR`, `MUSIC_DIR`, `DEPLOY_PATH`, `SERVER_HOST`/`SERVER_USER`.

2. **Adapt the scripts** — edit `DL_HOST`, `LIVE_CFG`, `AUTO_CFG`, `WANT_PROFILE` in `dmp-songkong-scan.sh` and `STATE` in `dmp-songkong-drain.sh` if your paths/profile differ.

3. **Deploy** — ships both scripts to `DEPLOY_PATH`, pre-creates the spool dirs + locks, runs `prisma db push` (adds the `songkongEnabled` setting + `ENRICHING` status):
   ```bash
   ./deploy
   ```

4. **Create the drainer cron** (every 2 min, root). TrueNAS:
   ```bash
   ssh nas 'sudo midclt call cronjob.create "{\"user\":\"root\",\"command\":\"/bin/sh /mnt/SSD/web/dmp/dmp-songkong-drain.sh >> /tmp/dmp-songkong-drain.log 2>&1\",\"description\":\"DMP: drain SongKong enrichment spool\",\"enabled\":true,\"stdout\":false,\"stderr\":false,\"schedule\":{\"minute\":\"*/2\",\"hour\":\"*\",\"dom\":\"*\",\"month\":\"*\",\"dow\":\"*\"}}"'
   ```
   (Plain crontab equivalent: `*/2 * * * * /bin/sh /mnt/SSD/web/dmp/dmp-songkong-drain.sh >> /tmp/dmp-songkong-drain.log 2>&1`)

5. **Enable** — Settings → Monitoring → "SongKong enrichment" = On, or set `SONGKONG_ENABLED=true`, or directly:
   ```bash
   ssh nas 'sudo docker exec dmp node -e "const{PrismaClient}=require(\"@prisma/client\");const p=new PrismaClient();p.settings.upsert({where:{id:\"main\"},update:{songkongEnabled:true},create:{id:\"main\",songkongEnabled:true}}).then(()=>p.\$disconnect()).then(()=>process.exit(0))"'
   ```

### Verify

```bash
# 1. drainer no-ops on empty spool
ssh nas 'sudo sh /mnt/SSD/web/dmp/dmp-songkong-drain.sh; echo exit=$?'        # exit=0

# 2. scan guard refuses paths outside /downloads
ssh nas 'sudo sh /mnt/SSD/web/dmp/dmp-songkong-scan.sh /music/x; echo exit=$?' # REFUSING…, exit=1

# 3. dedicated SongKong actually launches (enrich-only; tags only, no rename) on a real album
ssh nas 'sudo sh /mnt/SSD/web/dmp/dmp-songkong-scan.sh "/downloads/SOME ALBUM"' # → "Songs saved", "Completed", exit=0

# 4. live flow — trigger a download, watch it walk the pipeline
ssh nas 'sudo docker logs -f dmp'                                  # reconcile: → ENRICHING / → PENDING
ssh nas 'ls /mnt/SSD/Downloads/.dmp-songkong/{spool,done}'         # spool appears, then done marker
ssh nas 'tail -f /tmp/dmp-songkong-drain.log'                      # SongKong runs
```

### Gotchas

- **Never** point the scan at the live SongKong config dir — H2 lock deadlock. Always the dedicated `AUTO_CFG` via `docker run --rm`.
- Confirm the profile is genuinely **enrich-only** (no `renameFiles`/`moveFiles=true`) or SongKong will fight DMP's layout.
- BPM/mood stay empty — SongKong's source (AcousticBrainz) is shut down; AcoustID/genres/art/MBID work.
- Drainer down / SongKong stuck → downloads promote unenriched after `SONGKONG_MAX_WAIT_MIN`, never stranded.
- `prisma db push` runs *after* the container restart in `./deploy`, so a few `invalid enum "ENRICHING"` errors in the log during that gap are expected and self-heal.
