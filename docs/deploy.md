# Deployment

DMP runs as a Docker container on any Linux host reachable over SSH (e.g. a NAS).
The `deploy` script builds the image locally, ships it to the NAS, and restarts the stack.

## Prerequisites

- Docker running locally (for builds)
- SSH key access to the NAS (`SSH_KEY_PATH` in `.env`)
- `.env` filled out - see [Required env vars](#required-env-vars)

## Quick start

```bash
./deploy         # build, transfer, deploy, restart
```

## How it works

1. **Build** - runs `docker build` locally, producing a single `dmp:latest` image (Rust scripts + Nuxt app).
2. **Pack & transfer** - saves the image to `/tmp/dmp-image.tar.gz`, SCPs to the NAS.
3. **Load** - runs `docker load` on the NAS, then deletes the archive.
4. **Stage** - copies `docker-compose.yml` and the shell wrappers to `DEPLOY_PATH` and ensures the data dirs exist.
5. **Schema, before the swap** - a one-off container from the NEW image runs `prisma migrate deploy` (`docker compose run --rm --no-deps web prisma ...`) while the OLD container keeps serving. If a migration fails the deploy stops with the old container still running. Migrations only - never `db push` against production. Before applying, `prisma migrate status` is shown; if a pending migration is named `drop_dead_*`, `drop_column_*` or `drop_table_*` (data-removing, unlike index changes) the script warns to run `./backup` and asks to continue (skipped when not on a terminal or when `DEPLOY_ASSUME_BACKUP` is set).
6. **Restart** - `docker compose up -d web` swaps to the new image.
7. **Cleanup** - `docker image prune -f` on the NAS, once the old image is no longer in use.

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
Optional vars (image storage, S3, etc.) are documented in `.env` itself.

For first-time NAS setup (storage, SSH key, NAS `.env`) see [docs/truenas.md](truenas.md).

## Docker services

The `docker-compose.yml` at the project root defines these services:

| Service (container) | Description |
|---|---|
| `web` (`dmp`) | Nuxt app + Rust scripts - serves the UI/API on port `DMP_PORT` (default 3000) |
| `redis` (`dmp-redis`) | Redis cache (512 MB LRU) |
| `cloudflared` (`dmp-cloudflared`) | Cloudflare Tunnel - exposes the app publicly without port-forwarding |

Compose commands take the **service** name (`docker compose logs -f web`); `docker exec` takes the
**container** name (`sudo docker exec dmp cat /app/errors.log`).

## Running scripts on the NAS

Shell wrappers are deployed alongside `docker-compose.yml`. They invoke binaries inside the container via `docker exec`.

```bash
cd "$DEPLOY_PATH"   # /mnt/SSD/web/dmp
./index --from=a --to=z
```

For long-running commands, use tmux on the NAS host:

```bash
tmux new -s sync
cd "$DEPLOY_PATH"   # /mnt/SSD/web/dmp
./index --from=a --to=z && ./sync --from=a --to=z
# Ctrl+B, D to detach
```

## Cloudflare Tunnel

If you want to expose the NAS to the web via Cloudflare, you can use a Cloudflared Tunnel.

Set `CLOUDFLARE_TUNNEL_TOKEN` in `.env` to your tunnel token. The `cloudflared` container starts after the web container is healthy and keeps the tunnel alive automatically.

## Logs & status

```bash
# On the NAS
cd "$DEPLOY_PATH"   # /mnt/SSD/web/dmp
sudo docker compose ps
sudo docker compose logs -f web
sudo docker compose logs -f cloudflared
```
