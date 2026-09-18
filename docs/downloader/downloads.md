# Downloads

DMP finds and downloads missing albums for the artists you own, using Soulseek, then converts and
files them into your library automatically. This is the hub doc — the two subsystems it depends on
(the Soulseek client, and the optional tagging enrichment step) each have their own setup doc.

## Contents

- [What it does](#what-it-does)
- [How the pipeline works](#how-the-pipeline-works)
- [The Downloads page](#the-downloads-page)
- [Settings](#settings)
- [Setting up on a new machine](#setting-up-on-a-new-machine)
- [Related docs](#related-docs)

## What it does

On an artist page, a missing release shows a download icon — click it and DMP searches Soulseek, grabs the best copy, converts it, and stages it for approval into your library.

**Always-on mode**: turn on "Monitor" for an artist (or "Monitor all") and DMP keeps searching for missing albums in the background, self-paced so it doesn't hammer Soulseek/MusicBrainz even across thousands of artists.

Only one running copy of DMP drives this (`MONITOR_PRIMARY=true` on the NAS) — a second instance (e.g. local dev pointed at the same DB) is view-only, won't double-download.

## How the pipeline works

```
SEARCHING → DOWNLOADING → ENRICHING → READY ──(you click Merge)──┬─→ PROMOTED  (in your library)
                                                                   └─→ INVALID   (discarded, see below)
```

1. **Search** — DMP asks Soulseek for the album, picks the best-quality match it finds.
2. **Download** — transfers the files.
3. **Convert** — FLAC → MP3-320 by default (configurable; can be left as FLAC).
4. **Enrich** *(optional)* — a tagging tool ([SongKong](downloads_songkong.md)) fills in extra tags
   (genres, cover art, BPM) before filing.
5. **Ready** — the finished album waits in a holding area, no action taken on your library yet.
6. **Merge** — the one thing you (usually) do by hand: click **Merge** and DMP moves it into your
   library. If MusicBrainz can positively identify the files, it's added for good (**Promoted**); if
   it can't (bad/missing tags, wrong release), the files are discarded (**Invalid**) and DMP will try
   downloading a better copy later on its own.

A download that fails outright (dead transfer, disconnected peer) is retried automatically, up to a
handful of attempts, before being marked **Failed**. A search that simply finds nothing is **not**
counted as a failure — it goes **Unavailable** and DMP will look again after a cooldown (a week by
default), forever, deprioritized behind fresher candidates.

## The Downloads page

`/downloads` has five tabs:

| Tab | What's there |
|-----|---------------|
| **Monitoring** | Turn background acquisition on/off per artist, with a live count of how many are monitored |
| **Ready to merge** | Finished downloads waiting for you to click Merge (or Merge all) |
| **Queue** | Everything currently in flight or stuck, filterable: All / Downloading / Failed / Unavailable / Rejected |
| **History** | Permanent record of finished merges: Promoted (made it into the library) / Invalid (discarded) |
| **Events** | Background warnings/errors (e.g. a stalled enrichment step, a lock conflict) — surfaces problems that would otherwise only be in a server log |

The page header (shown on every tab) has **Pause all downloads** (halts new work everywhere while
letting in-flight transfers finish), **Monitor all/none**, a live progress bar for anything currently
downloading, and **Cleanup** (removes leftover ready-folders whose database row got lost, e.g. after
a crash).

## Settings

Everything below can be set either as an environment variable or in **Settings → Downloads /
Monitoring** in the app — the app setting always wins if both are set, and app changes apply
immediately (no restart).

| Setting | Default | What it controls |
|---|---|---|
| `DOWNLOADS_PATH` | `/mnt/SSD/Downloads/dmp` | Where downloads are staged before merging |
| `DOWNLOAD_DIR_TEMPLATE` | `{artist}/{year} - {album}` | Staging folder naming |
| `DOWNLOAD_FORMATS` | `flac,mp3` | Which formats DMP will accept from Soulseek |
| `DOWNLOAD_MIN_BITRATE` | *(none)* | Minimum acceptable bitrate |
| Downloads on/off | on | Master Soulseek switch (`DOWNLOADS_ENABLED`) |
| Convert to MP3 | on, 320kbps | `FLAC_TO_MP3` / `FLAC_TO_MP3_BITRATE` |
| SongKong enrichment | off | `SONGKONG_ENABLED` — see [downloads_songkong.md](downloads_songkong.md) |
| Auto-merge | off | `AUTO_MERGE` — skip the manual Merge click entirely |
| Max concurrent downloads | 5 | `MAX_CONCURRENT_DOWNLOADS` |
| Searches per minute-ish | 3 every 60s | `SEARCH_PICKS_PER_INTERVAL` / `SEARCH_INTERVAL_SEC` |
| Retry cooldown | 7 days | How long before an unavailable/failed release is searched again |
| Attempts before giving up | 3 | `MAX_DOWNLOAD_ATTEMPTS` — after this a release is Abandoned |
| Catalogue refresh | 20 artists every 5 min | `GAPS_PICKS_PER_RUN` / `GAPS_INTERVAL_MIN` — how fast new-release detection cycles the whole library |
| Minimum free disk space | 5 GB | `DOWNLOADS_MIN_FREE_GB` — auto-pauses everything below this |

`MONITOR_PRIMARY` (env-only, set on the NAS, never in the app) picks which running instance drives
all of the above — see [What it does](#what-it-does).

## Setting up on a new machine

1. **Set up Soulseek access first** — see [downloads_slskd.md](downloads_slskd.md). You need a
   reachable slskd URL + API key before anything here works.
2. **Give DMP and slskd a shared downloads folder.** They must both be able to read/write the same
   real path on disk (see the slskd doc's Architecture section for why). On the NAS:
   ```bash
   ssh nas '
     sudo mkdir -p /mnt/SSD/Downloads/dmp/_ready
     sudo chown -R :568 /mnt/SSD/Downloads/dmp
     sudo chmod -R 2775 /mnt/SSD/Downloads/dmp'
   ```
3. **Set the env vars** in `web/.env` (or the deploy `.env` on the NAS):
   ```
   DOWNLOADS_PATH=/mnt/SSD/Downloads/dmp
   SLSKD_URL=http://<nas-ip>:5030
   SLSKD_API_KEY=<from slskd.yml>
   SESSION_SECRET=<random string — required, the app refuses to start in production without it>
   ```
4. **Deploy** (`./deploy`) and turn it on: **Settings → Downloads** (confirm it's enabled) and
   **Settings → Monitoring**, or just hit **Monitor all** on the Downloads page.
5. *(Optional)* Set up tag enrichment — see [downloads_songkong.md](downloads_songkong.md). Skip this
   step entirely if you don't need it; downloads work fine without it.

## Related docs

- [downloads_slskd.md](downloads_slskd.md) — Soulseek/slskd setup (required)
- [downloads_songkong.md](downloads_songkong.md) — optional tag-enrichment setup
- [feature_monitoring.md](feature_monitoring.md) — the artist-monitoring feature this pipeline reads from
