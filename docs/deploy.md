# Deployment

DMP runs as a Docker container on a NAS (TrueNAS / any Linux host reachable over SSH).
The `deploy.sh` script builds the image locally, ships it to the NAS, and restarts the stack.

## Prerequisites

- Docker running locally (for builds)
- SSH key access to the NAS (`SSH_KEY_PATH` in `.env`)
- `.env` filled out — see [Required env vars](#required-env-vars)

## Quick start

```bash
./deploy.sh          # build, transfer, deploy, restart
```

## How it works

1. **Build** — runs `docker build` locally, producing a single `dmp:latest` image (Rust scripts + Nuxt app).
2. **Pack & transfer** — saves the image to `/tmp/dmp-image.tar.gz`, SCPs to the NAS.
3. **Load** — runs `docker load` on the NAS, then deletes the archive.
4. **Deploy** — copies `docker-compose.yml` to `DEPLOY_PATH` on the NAS, runs `docker compose up -d web`.
5. **Schema** — runs `prisma db push` inside the container to apply any schema changes.

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

The `docker-compose.yml` at the project root defines these services:

| Service | Description |
|---|---|
| `dmp` | Nuxt app + Rust scripts — serves the UI/API on port `DMP_PORT` (default 3000) |
| `dmp-redis` | Redis cache (512 MB LRU) |
| `dmp-cloudflared` | Cloudflare Tunnel — exposes the app publicly without port-forwarding |

## Running scripts on the NAS

Shell wrappers are deployed alongside `docker-compose.yml`. They invoke binaries inside the container via `docker exec`.

```bash
cd /mnt/SSD/web/dmp
./index --from=a --to=z
./sync --only="Artist Name"
./audit
./fix --corrupted
```

For long-running commands, use tmux on the NAS host:

```bash
tmux new -s sync
cd /mnt/SSD/web/dmp
./index --from=a --to=z && ./sync --from=a --to=z
# Ctrl+B, D to detach
```

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
