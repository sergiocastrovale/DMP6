# Downloads - tag enrichment (SongKong)

Optional step in the [downloads pipeline](downloads.md): before a downloaded album is filed into
your library, [SongKong](https://www.jthink.net/songkong/) can fill in extra tags — AcoustID,
genres, cover art, MusicBrainz IDs — that Soulseek downloads often lack. Skip this doc entirely if
you don't need it; downloads work fine without it (`SONGKONG_ENABLED` defaults to off).

## Contents

- [Why it's set up this way](#why-its-set-up-this-way)
- [Setting up on a new machine](#setting-up-on-a-new-machine)
- [Verify it's working](#verify-its-working)
- [Troubleshooting](#troubleshooting)

## Why it's set up this way

DMP's own container has no way to launch another Docker container, and SongKong's normal (GUI)
server holds an exclusive lock on its own database — so DMP can't just call the SongKong you already
run for your own library. Instead, DMP launches a **second, disposable** SongKong (its own throwaway
config, deleted/reused each time) purely to tag files, never to rename or move them — DMP does that
part itself.

```
DMP finishes a download → drops a marker file ──(a cron job, every 2 min)──→ launches SongKong
DMP picks up the tagged files ◄──────────────────── done marker ◄──────────────────────┘
```

The only thing that has to come from your existing SongKong install is your **license** — everything
else (the tagging profile — which fields to fix, told to *never* rename/move files) is bundled in
this repo and applied automatically. No manual SongKong GUI setup needed.

If it's ever unavailable or stuck, downloads don't get stuck waiting for it — after a timeout
(30 min by default) they proceed unenriched.

## Setting up on a new machine

**Prerequisites**
- The main [downloads pipeline](downloads.md) already working (Soulseek reachable).
- A SongKong container running somewhere with a **valid license file**.

**Steps**

1. Confirm the paths in `scripts/monitor/songkong-scan.sh` and `songkong-drain.sh` match your NAS
   (defaults assume `/mnt/SSD/Downloads` for downloads and `/mnt/SSD/songkong` for your license).
2. Deploy — ships the scripts + bundled tagging profile, creates the working folders:
   ```bash
   ./deploy
   ```
3. Create the cron job that drains finished enrichments, every 2 minutes (TrueNAS):
   ```bash
   ssh nas 'sudo midclt call cronjob.create "{\"user\":\"root\",\"command\":\"/bin/sh /mnt/SSD/web/dmp/scripts/monitor/songkong-drain.sh >> /tmp/songkong-drain.log 2>&1\",\"description\":\"DMP: drain SongKong enrichment spool\",\"enabled\":true,\"stdout\":false,\"stderr\":false,\"schedule\":{\"minute\":\"*/2\",\"hour\":\"*\",\"dom\":\"*\",\"month\":\"*\",\"dow\":\"*\"}}"'
   ```
   (Plain crontab: `*/2 * * * * /bin/sh /mnt/SSD/web/dmp/scripts/monitor/songkong-drain.sh >> /tmp/songkong-drain.log 2>&1`)
4. Turn it on: **Settings → Monitoring → SongKong enrichment**, or set `SONGKONG_ENABLED=true`.

## Verify it's working

```bash
# drainer runs cleanly with nothing to do
ssh nas 'sudo sh /mnt/SSD/web/dmp/scripts/monitor/songkong-drain.sh; echo exit=$?'   # exit=0

# trigger a real download in the app, then watch it move through the pipeline
ssh nas 'sudo docker logs -f dmp'                            # look for "-> ENRICHING" then "-> READY"
ssh nas 'ls /mnt/SSD/Downloads/.dmp-songkong/{spool,done}'    # a marker appears, then moves to done
```

## Troubleshooting

- **Never** point SongKong at your live/GUI config folder for this — it'll deadlock on the database
  lock. It must always use its own disposable config folder.
- BPM/mood tags stay empty — SongKong's source for those (AcousticBrainz) has been shut down.
  AcoustID, genres, cover art and MusicBrainz IDs still work.
- Drainer down or SongKong stuck → affected downloads just proceed unenriched after the timeout;
  nothing gets stuck waiting forever.
- Right after a fresh deploy, a few `invalid enum "ENRICHING"` lines in the log are expected for a
  moment (database catching up) and resolve on their own.
