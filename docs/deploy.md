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

### Encrypting stored credentials (`SETTINGS_ENCRYPTION_KEY`)

The keys entered in Settings (slskd, S3, Fanart.tv, Genius, the Last.fm application secret) and every user's Last.fm
session key sit in the database, so a `./backup` dump or a replica would carry them in the clear. Setting
`SETTINGS_ENCRYPTION_KEY` (at least 32 characters, `openssl rand -base64 32`) in the NAS `.env` encrypts them at rest with
AES-256-GCM (`web/server/utils/secretBox.ts`). It is deliberately not `SESSION_SECRET`, so rotating one never breaks the other.

- **Turning it on:** add the variable and redeploy. At boot the web app rewrites the plaintext values it finds as
  `enc:v1:...` (one compare-and-set write per value, idempotent, logged to the monitor log as "settings encryption: N stored
  secret(s) ..."). A key that is set but shorter than 32 characters stops the app at boot. Values saved from Settings after
  that are encrypted as they are written.
- **Scripts:** the Rust binaries read the S3 and Fanart keys from the same table and decrypt them with the same variable
  (`scripts/common/src/secrets.rs`), so it has to be in their environment too - the compose file passes it to the `dmp`
  container, where the tmux-run scripts inherit it. A script that cannot open a value falls back to its env value.
- **Losing or changing the key:** encrypted values can no longer be read and show as "not set". Enter them again in
  Settings (and each user reconnects Last.fm). There is no rotation tool - back the key up with your other secrets.
- **Turning it off:** removing the variable does not decrypt anything; the encrypted values become unreadable as above.

### Least-privilege database role for the web app (`WEB_DATABASE_URL`)

Until it is set, the web app, the Rust scripts, migrations and backups all connect as the same Postgres role (`dmp`, a
superuser), so an injection through any web query would have full control of the cluster. `scripts/sql/create_web_role.sql`
creates `dmp_web`: no superuser/createdb/createrole, DML on the `public` tables and sequences only (`_prisma_migrations`
excluded, later migrations' tables covered by default privileges), `CONNECTION LIMIT 40`, and a role-level
`statement_timeout` of 60s and `idle_in_transaction_session_timeout` of 60s (the heavy endpoints set a tighter limit of
their own with `withStatementTimeout`; 60s is generous on purpose so a bulk merge is not killed mid-way).

1. As the owner role, once: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v web_password='<long random password>' -f scripts/sql/create_web_role.sql`
2. In the NAS `.env`: `WEB_DATABASE_URL=postgresql://dmp_web:<password>@<same host>:5432/<same db>?connection_limit=20&pool_timeout=10`
   (the pool settings for the web app belong here, not on `DATABASE_URL`), then redeploy. The compose file passes it to the
   `dmp` container.

`DATABASE_URL` stays the owner: `prisma migrate deploy` (the deploy script's one-off container), the Rust scripts (tmux runs
inherit the container environment) and `./backup` keep the rights they need. `server/utils/prisma.ts` is the only place
that reads `WEB_DATABASE_URL`. What it does **not** cover: the container still holds `DATABASE_URL`, so code execution in
the web process (as opposed to SQL injection) can still reach the owner credentials. Roll back by unsetting the variable.
Every e2e run boots the app as this role (`e2e/with-test-db.ts`), and `test/integration/webRole.test.ts` replays the SQL
file and checks what the role can and cannot do, so a new query the role does not allow fails CI instead of production.

### Memory: the scripts share the web container

`index`, `sync`, `tidy` and `mosaic` run inside the `dmp` container (tmux or a spawned child), so a scan that outgrows the
container's memory limit used to leave the kernel free to kill the web server instead of the scan. Every way the web app
starts a script now raises that process's `oom_score_adj` to 500 first (`web/server/utils/oomShield.ts`: the terminal's tmux
wrapper, `runScript`, the mosaic generator; children inherit it), so the OOM killer prefers the scan. Checked with a 100 MB
container: a 60 MB process plus a growing 80 MB hog killed the 60 MB one unshielded, and the hog once shielded.

The limit itself is `WEB_MEMORY_LIMIT` in the NAS `.env` (default `2G`); a scan that is killed for lack of memory needs it raised.
Not done: a separate `dmp-scripts` container. The web app would need to start processes in it, which means the Docker socket
(root on the NAS) or a shared tmux socket plus moving every direct spawn (auto-scan, merges, gaps, mosaic) - more moving parts
and more privilege than the problem justifies while the shield holds.

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
