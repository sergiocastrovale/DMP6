# TrueNAS Setup

Deploy DMP on TrueNAS Scale. Images are built on your dev machine and pushed to the NAS via `web/deploy.sh`.

## Prerequisites

- TrueNAS Scale 25.04+, PostgreSQL app installed
- Docker on your dev machine
- SSH access: user `Kp` with full privileges
- Music at `/mnt/dmp/music/mainstream`, SSD pool at `/mnt/SSD`

---

## 1. Database

```bash
psql -h 192.168.1.241 -p 5432 -U postgres
```

```sql
CREATE USER dmp WITH PASSWORD 'your-password';
CREATE DATABASE dmp OWNER dmp;
GRANT ALL PRIVILEGES ON DATABASE dmp TO dmp;
```

Verify: `psql postgresql://dmp:your-password@192.168.1.241:5432/dmp -c "SELECT 1;"`

---

## 2. NAS Storage

```bash
ssh nas
mkdir -p /mnt/SSD/web/dmp/{img/artists,img/releases,dump,redis}
chown -R 999:999 /mnt/SSD/web/dmp   # 999 = node user inside the container
```

---

## 3. SSH Key (first time)

```bash
# Dev machine
ssh-keygen -t ed25519 -f ~/.ssh/nas -N ""
eval "$(ssh-agent -s)"
```

Add to `~/.ssh/config`:

```
Host nas
    HostName 192.168.1.241
    User Kp
    IdentityFile ~/.ssh/nas
    IdentitiesOnly yes
```

In TrueNAS UI: **Credentials > Local Users > Kp > Edit** → paste `~/.ssh/nas.pub` into **SSH Public Keys**.

Enable SSH: **System > Services > SSH** → Running + Start Automatically.

Set in `web/.env`:

```env
SERVER_HOST=192.168.1.241
SERVER_USER=Kp
DEPLOY_PATH=/mnt/SSD/web/dmp
SSH_KEY_PATH=~/.ssh/nas
```

---

## 4. Build Images

```bash
cd /home/kp/web/DMPv6
web/deploy.sh build
```

Produces `dmp-web:latest` (~800MB) and `dmp-scripts:latest` (~50MB).

---

## 5. NAS `.env`

```bash
ssh nas
nano /mnt/SSD/web/dmp/.env
```

```env
DATABASE_URL=postgresql://dmp:your-password@host.docker.internal:5432/dmp?connection_limit=20&pool_timeout=10
MUSIC_DIR=/mnt/dmp/music/mainstream
DMP_DATA=/mnt/SSD/web/dmp
DMP_PORT=3000
ADMIN_USER=kp
ADMIN_PASSWORD=your-password
```

> **`host.docker.internal`**: use this (or the NAS LAN IP) for PostgreSQL — `localhost` won't work from inside the DMP container.

---

## 6. Deploy

```bash
# From dev machine
web/deploy.sh          # build + transfer + restart (full)
web/deploy.sh push     # transfer pre-built images only
web/deploy.sh deploy   # copy docker-compose.yml + restart only
```

See [docs/deploy.md](deploy.md) for all modes.

---

## 7. Verify

```bash
ssh nas
docker ps
docker inspect --format='{{.State.Health.Status}}' dmp-web
curl http://localhost:3000/api/stats
```

Access: `http://192.168.1.241:3000`

---

## 8. Initial Data Load

### Option A — Restore a backup

```bash
# Dev machine
cd web && pnpm backup   # → dump/YYYY-MM-DD-HH-MM-SS.sql.gz
scp "dump/$(ls -t dump/ | head -1)" nas:/mnt/SSD/web/dmp/dump/

# NAS
ssh nas
cd /mnt/SSD/web/dmp
docker exec -it ix-postgres-postgres-1 psql -U dmp -d postgres -c "DROP DATABASE IF EXISTS dmp;"
docker exec -it ix-postgres-postgres-1 psql -U dmp -d postgres -c "CREATE DATABASE dmp OWNER dmp;"
gunzip -c "dump/$(ls -t dump/ | head -1)" | docker exec -i ix-postgres-postgres-1 psql -U dmp -d dmp
docker restart dmp-web
```

### Option B — Fresh sync

Takes several hours on a large library.

```bash
ssh nas
cd /mnt/SSD/web/dmp
./sync
```

---

## 9. Long-Running Sync Sessions (tmux)

A full library sync can take many hours. Use `tmux` to keep it running after you disconnect — it's pre-installed on TrueNAS Scale.

### Start a session and run sync

```bash
ssh nas
tmux new -s sync
cd /mnt/SSD/web/dmp
./sync --from=a --to=z
```

### Detach and disconnect

Press **Ctrl+B**, then **D** — the sync keeps running in the background. You can now close your terminal or shut down your dev machine entirely.

### Reconnect later to check progress

```bash
ssh nas
tmux attach -t sync
```

### Other useful tmux commands

| Command | What it does |
|---|---|
| `tmux ls` | List active sessions |
| `tmux attach -t sync` | Reattach to the sync session |
| `tmux kill-session -t sync` | Kill the session (stops the sync) |

The session persists until the NAS reboots or you kill it manually. If the NAS does reboot mid-sync, use `./sync --resume` when you restart.

---

## 11. Running Scripts

Wrapper scripts live at `DEPLOY_PATH` (e.g. `/mnt/SSD/web/dmp/`). They source `.env` automatically and invoke the correct Docker command.

```bash
ssh nas
cd /mnt/SSD/web/dmp

./sync                           # full index + MB sync
./sync --resume                  # continue from last checkpoint
./sync --only="Artist Name"      # single artist
./sync --only="Artist" --overwrite
./sync --from=a --to=cz          # letter range batch
./analysis                       # metadata quality HTML report
./clean                          # process S3 deletion queue
./clean --dry-run
./nuke                           # DESTRUCTIVE — full DB reset
./nuke --local-only              # keep MB catalogue, reset local data
./audit                          # data integrity → XLSX
```

The same wrapper scripts from the project root (`sync`, `analysis`, etc.) are deployed automatically by `web/deploy.sh deploy` (or a full deploy). Each script is dual-mode: when a local Rust binary is available it runs directly; on the NAS (no binary, no cargo) it falls back to Docker via `scripts/_docker_run`.

---

## 12. Updates

```bash
web/deploy.sh          # rebuild + redeploy everything
web/deploy.sh web      # web only
web/deploy.sh scripts  # scripts only
```

---

## 13. Monitoring

```bash
docker ps
docker logs -f dmp-web
docker stats dmp-web
docker inspect --format='{{json .State.Health}}' dmp-web | python3 -m json.tool
docker restart dmp-web
```

---

## 14. Tailscale

Access from anywhere: `http://NAS_TAILSCALE_IP:3000`

---

## Performance Tuning

### PostgreSQL

Settings survive container recreation (written to `postgresql.auto.conf`). Requires a full restart.

```bash
ssh nas
for setting in \
  "shared_buffers = '8GB'" \
  "effective_cache_size = '24GB'" \
  "work_mem = '256MB'" \
  "maintenance_work_mem = '2GB'" \
  "wal_buffers = '64MB'" \
  "checkpoint_completion_target = 0.9" \
  "min_wal_size = '1GB'" \
  "max_wal_size = '4GB'" \
  "random_page_cost = 1.1" \
  "effective_io_concurrency = 200" \
  "max_worker_processes = 8" \
  "max_parallel_workers = 8" \
  "max_parallel_workers_per_gather = 4" \
  "max_connections = 50"
do
  docker exec ix-postgres-postgres-1 psql -U dmp -d dmp -c "ALTER SYSTEM SET $setting;"
done
docker restart ix-postgres-postgres-1

# Verify
docker exec ix-postgres-postgres-1 psql -U dmp -d dmp \
  -c 'SHOW shared_buffers; SHOW work_mem; SHOW max_connections; SHOW effective_cache_size;'

# Check settings survived a rebuild
docker exec ix-postgres-postgres-1 cat /var/lib/postgresql/data/postgresql.auto.conf
```

Sized for 32 GB RAM. Keep `SSD` pool defaults for PostgreSQL — random I/O benefits from smaller records and full ARC caching.

### Redis

`dmp-redis` runs as a sidecar; the web container connects via `REDIS_URL=redis://dmp-redis:6379` (set in `docker-compose.yml`). If unreachable the app falls through to the database silently.

Create the data dir before first deploy:

```bash
mkdir -p /mnt/SSD/web/dmp/redis
```

See [docs/redis.md](redis.md) for cached endpoints, TTLs, and invalidation.

### ZFS (music dataset)

```bash
ssh nas
sudo zfs set recordsize=1M dmp/music
sudo zfs set primarycache=metadata dmp/music
sudo zfs set atime=off dmp/music

zfs get recordsize,primarycache,atime dmp/music
```

Properties persist across reboots and TrueNAS upgrades.

## Domain configuration

### dmp.nrnas.com

`docker-compose.yml` is configured to work with a `dmp-cloudflared` container:

```yaml
cloudflared:
  image: cloudflare/cloudflared:latest
  container_name: dmp-cloudflared
  restart: unless-stopped
  command: tunnel --no-autoupdate run
  environment:
    - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
  depends_on:
    web:
      condition: service_healthy
```

Steps you need to do in Cloudflare before deploying:

  1. Create the tunnel:
    - Cloudflare dash → Zero Trust → Networks → Connectors → Create a tunnel
    - Connector type: Docker
    - Name: dmp
    - Copy the token from the docker run ... --token <TOKEN> command shown
  2. Networks -> Overview -> Route to a published application
    - Subdomain: dmp, Domain: nrnas.com
    - Service type: HTTP, URL: dmp-web:3000
  3. Add the token to the NAS .env:
  `ssh nas`
  `echo "CLOUDFLARE_TUNNEL_TOKEN=<your-token>" >> /mnt/SSD/web/dmp/.env`

  Then deploy:
  ```bash
  scp docker-compose.yml nas:/mnt/SSD/web/dmp/ && ssh nas "cd /mnt/SSD/web/dmp && docker compose up -d"
  ```

  Then https://dmp.nrnas.com should be live.
