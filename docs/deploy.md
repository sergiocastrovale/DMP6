# Deployment

DMP runs as Docker containers on a NAS (TrueNAS / any Linux host reachable over SSH).
The `deploy.sh` script in `web/` builds images locally, ships them to the NAS, and restarts the stack.

## Prerequisites

- Docker running locally (for builds)
- SSH key access to the NAS (`SSH_KEY_PATH` in `.env`)
- `.env` filled out — see [Required env vars](#required-env-vars)

## Quick start

```bash
cd web
./deploy.sh          # build both images, transfer, restart
./deploy.sh web      # rebuild + redeploy web only
./deploy.sh scripts  # rebuild + redeploy scripts only
./deploy.sh build    # build both images locally, no transfer
./deploy.sh push     # transfer already-built images (skip build)
./deploy.sh deploy   # upload docker-compose.yml + restart containers (no build)
```

## How it works

1. **Build** — runs `docker build` locally for `dmp-web` and/or `dmp-scripts`.
2. **Pack & transfer** — saves the image(s) to `/tmp/dmp-images.tar.gz`, SCPs to the NAS.
3. **Load** — runs `docker load` on the NAS, then deletes the archive.
4. **Deploy** (full run only) — copies `docker-compose.yml` and the script wrappers (`sync`, `analysis`, `clean`, `nuke`, `audit` + `scripts/_docker_run`) to `DEPLOY_PATH` on the NAS, then runs `docker compose up -d`. The wrappers are the same files used locally — on the NAS they detect no local binary and fall back to running via Docker.

## Required env vars

These must be set in `web/.env`. The deploy script sources this file.

| Variable | Purpose |
|---|---|
| `SERVER_HOST` | NAS IP or hostname |
| `SERVER_USER` | SSH user on the NAS |
| `DEPLOY_PATH` | Directory on the NAS where `docker-compose.yml` is kept |
| `SSH_KEY_PATH` | Path to your SSH private key (e.g. `~/.ssh/nas`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `MUSIC_DIR` | Path to the music library on the NAS |
| `DMP_DATA` | NAS path for persistent data (images, Redis, dumps) |
| `ADMIN_USER` | Login username for the web UI |
| `ADMIN_PASSWORD` | Login password — quote the value if it contains shell special chars |

Optional vars (image storage, S3, etc.) are documented in `.env` itself.

> **Shell special characters in passwords** — if `ADMIN_PASSWORD` contains `&`, `!`, `$`, backticks, or spaces, wrap the value in double quotes in `.env`:
> ```
> ADMIN_PASSWORD="my&p@ssw0rd!"
> ```

For first-time NAS setup (storage, SSH key, NAS `.env`) see [docs/truenas.md](truenas.md).

## Docker services

The `docker-compose.yml` at the project root defines three services:

| Service | Description |
|---|---|
| `dmp-web` | Nuxt app — serves the UI and API on port `DMP_PORT` (default 3000) |
| `dmp-redis` | Redis cache (512 MB LRU) |
| `dmp-cloudflared` | Cloudflare Tunnel — exposes the app publicly without port-forwarding |

## Cloudflare Tunnel

Set `CLOUDFLARE_TUNNEL_TOKEN` in `.env` to your tunnel token. The `cloudflared` container starts after the web container is healthy and keeps the tunnel alive automatically.

## Logs & status

```bash
# On the NAS
cd /mnt/SSD/web/dmp
docker compose ps
docker compose logs -f web
docker compose logs -f cloudflared
```
