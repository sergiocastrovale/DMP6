# Downloads — Soulseek (slskd)

## How it's set up on the NAS

slskd runs as a Docker service alongside DMP. Its config/state live in `/mnt/SSD/slskd/`; downloads go to a separate dataset at `/mnt/SSD/Downloads/` that's shared with the web container:

```
/mnt/SSD/slskd/
├── config/slskd.yml   # slskd configuration
└── data/              # internal state (database, logs)

/mnt/SSD/Downloads/    # finished downloads land here (shared with dmp)
```

The service is defined in [`docker-compose.yml`](../docker-compose.yml) and launches automatically when you run `docker compose up -d` or deploy via `./deploy.sh deploy`. Both `slskd` and `web` mount the same host path at `/downloads`, so DMP can move slskd's finished files into the templated `{artist}/{year} - {album}` folder.

## First-time setup

If slskd is already running on your NAS, skip to [Configuring DMP](#configuring-dmp).

### 1. Create the folders

Create the slskd config/data tree and the shared Downloads dataset. On TrueNAS, the `Downloads` dataset should already exist (create it in the UI: `SSD → Add Dataset → Downloads`). Then fix ownership so slskd can write to it:

```bash
ssh nas "sudo mkdir -p /mnt/SSD/slskd/{config,data} && sudo chown -R Kp:Kp /mnt/SSD/slskd"
ssh nas "sudo chown -R Kp:Kp /mnt/SSD/Downloads"
```

### 2. Write the config file

Create `/mnt/SSD/slskd/config/slskd.yml` on the NAS:

```yaml
soulseek:
  username: your_soulseek_username
  password: your_soulseek_password
  listen_port: 50300
  description: DMP

directories:
  downloads: /downloads

shares:
  directories: []

web:
  port: 5030
  authentication:
    api_keys:
      dmp:
        key: generate-a-long-random-string-here
        role: administrator
```

Generate the API key with `openssl rand -hex 32` and paste the output as the `key:` value.

### 3. Add env vars to NAS `.env`

Append these to `/mnt/SSD/web/dmp/.env`:

```
SLSKD_DATA=/mnt/SSD/slskd
DOWNLOADS_DIR=/mnt/SSD/Downloads     # host path, shared between slskd and web containers
SLSKD_URL=http://dmp-slskd:5030
SLSKD_API_KEY=the-same-api-key-from-slskd.yml
DOWNLOAD_DIR_TEMPLATE='{artist}/{year} - {album}'
DOWNLOAD_FORMATS=flac,mp3
DOWNLOAD_MIN_BITRATE=320
```

Notes:
- `SLSKD_URL` uses the docker hostname `dmp-slskd` because the DMP web container and slskd share the same docker network.
- `DOWNLOADS_DIR` is the *host* path that gets mounted into both containers at `/downloads`. Inside the web container, DMP sees it as `/downloads` (set automatically as `DOWNLOADS_PATH` by `docker-compose.yml`). You don't need to set `DOWNLOADS_PATH` yourself on the NAS.
- The default `DOWNLOADS_DIR` in `docker-compose.yml` is already `/mnt/SSD/Downloads`, so this line is only needed if you want a different path.

### 4. Start slskd

```bash
ssh nas "cd /mnt/SSD/web/dmp && docker compose up -d slskd"
```

slskd auto-restarts on reboot (`restart: unless-stopped` in compose), so this is a one-time command — that's what "daemon" means in a Docker context.

### 5. Verify

```bash
# Check the container is healthy
ssh nas "docker ps | grep dmp-slskd"

# Test the REST API
ssh nas "curl -s -H 'X-API-Key: YOUR_KEY' http://localhost:5030/api/v0/server"
# Expected: {"state":"Connected, LoggedIn","isConnected":true,...}

# Check slskd logs for successful login
ssh nas "docker logs dmp-slskd 2>&1 | tail -10"
# Expected: "Logged in to the Soulseek server as <username>"
```

Open `http://<nas-ip>:5030` in a browser — you should see the slskd web UI.

> **Port forwarding**: For Soulseek to work well, port `50300` should be reachable from the internet. Set up port forwarding on your router (forward `50300` to the NAS IP). Without it, downloads still work but are slower and less reliable.

## Configuring DMP

For the deployed DMP on the NAS, the env vars in step 3 above are all you need.

For **local dev** (`pnpm dev` on your workstation), add these to `web/.env`:

```
DOWNLOADS_PATH=/local/path/to/downloads
SLSKD_URL=http://<nas-ip>:5030
SLSKD_API_KEY=the-same-api-key
DOWNLOAD_DIR_TEMPLATE='{artist}/{year} - {album}'
DOWNLOAD_FORMATS=flac,mp3
DOWNLOAD_MIN_BITRATE=320
```

All of these can also be set in the `Settings` table — DB values override `.env`.

## Deploying changes

slskd is a pre-built image (pulled from Docker Hub), so there's nothing to build. To propagate a `docker-compose.yml` change from your local repo to the NAS, use the existing deploy script:

```bash
cd web && ./deploy.sh deploy
```

This copies `docker-compose.yml` to the NAS and runs `docker compose up -d`, which picks up any slskd changes automatically.

## Using it in DMP

On an artist page, missing releases show a download icon. Click it → pick **Soulseek** → DMP searches Soulseek peers, picks the best result automatically, and queues it with slskd. Progress streams into the side panel.

For bulk downloads, use the "Download missing" button at the top of the releases list.

## Where files end up

slskd writes files to its own `directories.downloads` (set to `/downloads` inside the container, backed by `${DOWNLOADS_DIR:-/mnt/SSD/Downloads}` on the host). After slskd finishes a transfer, DMP detects completion and **moves** the files into the templated artist/album folder inside the same `/downloads` volume — same layout as HiFi and Deezer (see [features_downloader.md](features_downloader.md#where-files-go)).

The move only works because `docker-compose.yml` mounts the same host directory into both `slskd` and `web`. If you ever split them onto separate volumes, the move step silently no-ops and files remain in slskd's flat structure.

Results are also sorted by upload speed (fastest first, free-slot peers prioritized) when you pick manually from the dialog.

## Everyday maintenance

| Task | Command |
|------|---------|
| Check status | `ssh nas "docker ps \| grep dmp-slskd"` |
| View logs | `ssh nas "docker logs -f dmp-slskd"` |
| Restart | `ssh nas "docker restart dmp-slskd"` |
| Stop | `ssh nas "docker stop dmp-slskd"` |
| Update to latest | `ssh nas "docker compose -f /mnt/SSD/web/dmp/docker-compose.yml pull slskd && docker compose -f /mnt/SSD/web/dmp/docker-compose.yml up -d slskd"` |
| Browse web UI | `http://<nas-ip>:5030` |
