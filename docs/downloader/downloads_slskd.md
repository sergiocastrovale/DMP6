# Downloads - Soulseek (slskd)

DMP downloads missing albums via **Soulseek**, using **slskd** (a Soulseek client with a web API).
**slskd is the only download tool DMP talks to** — no torrents, no indexers, no other sources.

DMP used to also search **RuTracker** (via a shared **Prowlarr** indexer, itself feeding a separate
**Lidarr** setup on the same NAS). That was removed — Soulseek alone proved sufficient — in migration
`20260902140000_remove_rutracker`, which dropped the `DownloadSources` table and every
Prowlarr/qBittorrent setting from the schema. DMP's code has no remaining reference to Lidarr,
Prowlarr, or qBittorrent. If you see them mentioned elsewhere (e.g. `lidarr-stack.md`), that's about
the separate, unrelated Lidarr automation stack that happens to run on the same NAS — not something
DMP needs.

## Architecture

slskd is **not** part of DMP's `docker-compose.yml`. It's a standalone instance running inside
gluetun's VPN network namespace (on this NAS it happens to be deployed alongside the unrelated
Lidarr stack, but nothing about DMP requires that). DMP just talks to it over HTTP.

```
gluetun netns (VPN)                         DMP compose (host network)
┌─────────────────────────────┐            ┌──────────────────────────┐
│ slskd  :5030  ────────────────HTTP───────►│ dmp (web) · redis        │
│   writes → /downloads/dmp    │            │ SLSKD_URL=…:5030         │
│                               │            │ DOWNLOADS_PATH=          │
└──────────────┬──────────────┘            │   /mnt/SSD/Downloads/dmp │
               │ both mount the host        └──────────────────────────┘
               ▼ Downloads dataset
        /mnt/SSD/Downloads   (gid 568, group-writable, setgid)
```

- slskd mounts the host `/mnt/SSD/Downloads` at `/downloads`; its `directories.downloads` is set to
  `/downloads/dmp` so DMP's downloads land in that subfolder.
- DMP's `web` container mounts the **same** host dataset (`/mnt/SSD/Downloads:/mnt/SSD/Downloads`),
  so it can see and move the files slskd writes. `DOWNLOADS_PATH` must resolve to the same real path
  on both sides.
- Don't add a second slskd to DMP's compose — it collides on port 5030 with the shared one.

Full media-stack setup (gluetun, permissions, Soulseek account): `~/web/nas-media-docs/lidarr-stack.md`.

## Setting up on a fresh system

Skip this if the media stack (and its slskd) already exists on the NAS — jump to
[Configuring DMP](#configuring-dmp), you only need its URL + API key.

### 1. Install/configure slskd

Config lives at `/mnt/SSD/slskd/config/slskd.yml`:

```yaml
soulseek:
  username: your_soulseek_username
  password: your_soulseek_password
  listen_port: 50300

directories:
  downloads: /downloads/dmp        # slskd mounts /mnt/SSD/Downloads -> /downloads

web:
  port: 5030
  authentication:
    api_keys:
      dmp:
        key: generate-a-long-random-string-here   # e.g. openssl rand -hex 32
        role: administrator
```

Run the container as `user: "0:568"` with `SLSKD_UMASK=0002` — this makes everything it writes
group-writable, which DMP needs to move/delete files later.

> **Port forwarding**: forward Soulseek's `listen_port` (`50300`) through your VPN provider for best
> download speed. Not required, just faster.

### 2. Configure DMP

Set these in the NAS `.env` (`$DEPLOY_PATH/.env`, the DMP deploy env — not slskd's):

```
DOWNLOADS_DIR=/mnt/SSD/Downloads        # host dataset, mounted into the web container
DOWNLOADS_PATH=/mnt/SSD/Downloads/dmp   # DMP's downloads subfolder
SLSKD_URL=http://192.168.1.241:5030     # the shared slskd, reachable on the NAS host
SLSKD_API_KEY=the-same-api-key-from-slskd.yml
DOWNLOAD_DIR_TEMPLATE='{artist}/{year} - {album}'
DOWNLOAD_FORMATS=flac,mp3
DOWNLOAD_MIN_BITRATE=320
```

All of these can also be set in **Settings → Downloads** in the DMP web UI — DB values there
override `.env`.

For **local dev** (`pnpm dev` on a workstation), point `SLSKD_URL` at the NAS and use a local
folder for `DOWNLOADS_PATH` in `web/.env`.

### 3. Verify

```bash
# slskd is reachable and logged in to Soulseek
ssh nas "curl -s -H 'X-API-Key: YOUR_KEY' http://localhost:5030/api/v0/server"
# expect: {"state":"Connected, LoggedIn","isConnected":true,...}
```

Or open `http://<nas-ip>:5030` for the slskd web UI.

## Configuring DMP

For the deployed DMP on the NAS, the env vars above are all that's needed — nothing else to set up.

## Using it

On an artist page, missing releases show a download icon. Click it → DMP searches Soulseek, picks
the best result, and queues it with slskd. For always-on, hands-off downloading across monitored
artists, see [downloads.md](downloads.md) and [feature_monitoring.md](feature_monitoring.md).

## Where files end up

slskd writes into `/downloads/dmp` (= `/mnt/SSD/Downloads/dmp` on the host). When a download
finishes, DMP detects it and **moves** the files into `{artist}/{year} - {album}` folders inside
that same root, transcoding to MP3-320 if `FLAC_TO_MP3` is on (default) — see
[downloads.md](downloads.md#how-the-pipeline-works).

This only works because DMP's container can see the same host folder slskd writes to. If slskd is
ever pointed at a dataset DMP can't see, the move silently no-ops and files stay in slskd's raw
output folder.

## Everyday maintenance

slskd belongs to the media stack, not DMP's `./deploy` — manage it via the stack's compose
(`lidarr-stack.md`). DMP only ever reads its API.

| Task | Command |
|------|---------|
| Check status | `ssh nas "sudo docker ps \| grep slskd"` |
| View logs | `ssh nas "sudo docker logs -f slskd"` |
| Restart | `ssh nas "sudo docker restart slskd"` |
| API health | `ssh nas "curl -s -H 'X-API-Key: KEY' http://localhost:5030/api/v0/server"` |
| Browse web UI | `http://<nas-ip>:5030` |
