# Downloads - Soulseek (slskd)

## Architecture (important)

slskd is **NOT** part of DMP's `docker-compose.yml`. It's a **shared instance** that belongs to the
media-automation stack (Prowlarr · Lidarr · slskd · qBittorrent), all running **inside gluetun's
network namespace** (behind the VPN). DMP only talks to it over HTTP via `SLSKD_URL`.

```
gluetun netns (VPN)                         DMP compose (host network)
┌─────────────────────────────┐            ┌──────────────────────────┐
│ Lidarr · Prowlarr · qbit     │            │ dmp (web) · redis        │
│ slskd  :5030  ───────────────┼──HTTP──────┤ SLSKD_URL=…:5030         │
│   writes → /downloads/dmp    │            │ DOWNLOADS_PATH=          │
└──────────────┬──────────────┘            │   /mnt/SSD/Downloads/dmp │
               │ both mount the host         └──────────────────────────┘
               ▼ Downloads dataset
        /mnt/SSD/Downloads   (gid 568, group-writable, setgid)
```

- slskd mounts the host `/mnt/SSD/Downloads` at `/downloads`; its `directories.downloads` is set to
  **`/downloads/dmp`** so DMP's acquisitions land in the `dmp/` subfolder (the DMP downloads root).
- DMP's `web` container **identity-mounts** the same host dataset (`/mnt/SSD/Downloads:/mnt/SSD/Downloads`),
  so `DOWNLOADS_PATH=/mnt/SSD/Downloads/dmp` is a **real host path** — identical in `.env`, the Settings
  DB, and the container. slskd writes to `/downloads/dmp` = the same host dir `/mnt/SSD/Downloads/dmp`,
  which is why DMP can move/transcode the finished files in place.
- Don't add a second slskd to DMP's compose — it collides on port 5030 with the shared one.

See `~/web/nas-media-docs/lidarr-stack.md` for the full media-stack setup (gluetun, user `0:568`,
`SLSKD_UMASK=0002`, the `microwavez` Soulseek account, gid-568 permissions).

## First-time setup

If the media stack's slskd is already running (it usually is), skip to [Configuring DMP](#configuring-dmp)
— you only need its URL + API key. Set up slskd from scratch **only on a fresh NAS without the stack**.

### 1. slskd config

slskd config/state live at `/mnt/SSD/slskd/{config,data}`. The relevant DMP setting in
`/mnt/SSD/slskd/config/slskd.yml`:

```yaml
soulseek:
  username: your_soulseek_username
  password: your_soulseek_password
  listen_port: 50300
  description: slskd

directories:
  downloads: /downloads/dmp        # DMP's downloads root (slskd mounts /mnt/SSD/Downloads -> /downloads)

web:
  port: 5030
  authentication:
    api_keys:
      dmp:
        key: generate-a-long-random-string-here   # openssl rand -hex 32
        role: administrator
```

slskd runs `user: "0:568"` + `SLSKD_UMASK=0002` so everything it writes is group-568-writable — that's
what lets the dmp container (joined to gid 568 via `group_add` in compose) delete slskd-owned source
files during the post-download move. See the permissions note in `lidarr-stack.md`.

### 2. DMP env vars (NAS `.env`)

In the NAS `.env` (`$DEPLOY_PATH/.env`) (the DMP deploy `.env`, **not** slskd's):

```
DOWNLOADS_DIR=/mnt/SSD/Downloads        # host dataset, identity-mounted into the web container
DOWNLOADS_PATH=/mnt/SSD/Downloads/dmp   # DMP downloads root (the dmp/ subfolder)
SLSKD_URL=http://192.168.1.241:5030     # the shared slskd, published on gluetun
SLSKD_API_KEY=the-same-api-key-from-slskd.yml
DOWNLOAD_DIR_TEMPLATE='{artist}/{year} - {album}'
DOWNLOAD_FORMATS=flac,mp3
DOWNLOAD_MIN_BITRATE=320
```

Notes:
- `SLSKD_URL` points at slskd's published port on the NAS host (`192.168.1.241:5030`). slskd lives in
  gluetun's netns, not on DMP's docker network, so the docker-internal default
  (`http://host.docker.internal:5030`, paired with `extra_hosts: host-gateway`) also works from the
  web container — set the explicit host IP to be unambiguous.
- `DOWNLOADS_DIR` is the host dataset; compose identity-mounts it. `DOWNLOADS_PATH` is the `dmp/`
  subfolder and must match slskd's `directories.downloads` once translated through slskd's
  `/mnt/SSD/Downloads -> /downloads` mount (`/downloads/dmp` == `/mnt/SSD/Downloads/dmp`).
- All download settings can also live in the `Settings` table — DB values override `.env`.

### 3. Verify

```bash
# REST API reachable + logged in to Soulseek
ssh nas "curl -s -H 'X-API-Key: YOUR_KEY' http://localhost:5030/api/v0/server"
# Expected: {"state":"Connected, LoggedIn","isConnected":true,...}

# slskd container (managed by the media stack, in gluetun's netns)
ssh nas "sudo docker logs slskd 2>&1 | tail -10"   # "Logged in to the Soulseek server as <username>"
```

Open `http://<nas-ip>:5030` for the slskd web UI.

> **Port forwarding**: for Soulseek to perform well, forward `50300` to the NAS (gluetun handles this
> when the VPN provider supports port forwarding). Without it, downloads still work but are slower.

## Configuring DMP

For the deployed DMP on the NAS, the env vars above are all you need.

For **local dev** (`pnpm dev` on your workstation), point at the NAS's slskd and use a local downloads
folder, in `web/.env`:

```
DOWNLOADS_PATH=/local/path/to/downloads
SLSKD_URL=http://<nas-ip>:5030
SLSKD_API_KEY=the-same-api-key
DOWNLOAD_DIR_TEMPLATE='{artist}/{year} - {album}'
DOWNLOAD_FORMATS=flac,mp3
DOWNLOAD_MIN_BITRATE=320
```

All of these can also be set in the `Settings` table — DB values override `.env`.

## Using it in DMP

On an artist page, missing releases show a download icon. Click it → DMP searches Soulseek peers, picks
the best result automatically, and queues it with slskd. For always-on, hands-off acquisition across all
monitored artists, see [features_downloader.md](features_downloader.md) and
[feature_monitoring.md](feature_monitoring.md) — the background workers drive the same slskd API.

## Where files end up

slskd writes to its `directories.downloads` (`/downloads/dmp` in the container = `/mnt/SSD/Downloads/dmp`
on the host). When a transfer finishes, DMP's reconcile loop detects completion and **moves** the files
into the templated `{artist}/{year} - {album}` folder inside the same `dmp/` root, transcoding to
MP3-320 — see [features_downloader.md](features_downloader.md#where-files-go).

The move works because the web container identity-mounts `/mnt/SSD/Downloads` and slskd writes into the
same host dataset. If you ever point slskd at a dataset DMP can't see, the move silently no-ops and files
remain in slskd's flat structure.

## Everyday maintenance

slskd is owned by the media stack, **not** DMP's `./deploy`. Manage it with the stack's compose (see
`lidarr-stack.md`); from DMP's side you only ever read its API.

| Task | Command |
|------|---------|
| Check status | `ssh nas "sudo docker ps \| grep slskd"` |
| View logs | `ssh nas "sudo docker logs -f slskd"` |
| Restart | `ssh nas "sudo docker restart slskd"` |
| API health | `ssh nas "curl -s -H 'X-API-Key: KEY' http://localhost:5030/api/v0/server"` |
| Browse web UI | `http://<nas-ip>:5030` |
