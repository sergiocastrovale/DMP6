# Setup: TrueNAS Scale

Deploy DMP on TrueNAS Scale using Docker Compose. The NAS runs the web app and scripts — your dev machine is only used for building Docker images.

## Prerequisites

- TrueNAS Scale 25.04+ (native Docker Compose support)
- PostgreSQL app installed and running in TrueNAS
- SSH access to TrueNAS
- Docker installed on your dev machine (for building images)
- 'Kp' is has full privileges in your NAS
- /mnt/nas is your main pool
- /mnt/dmp is your DMP pool
- /mnt/dmp/music/mainstream is the path to the archive
- /mnt/SSD is the drive where your postgres and web projects live

## 1. Database Setup

### Find PostgreSQL Connection Details

In TrueNAS web UI, go to **Apps > PostgreSQL** and note:
- The mapped port (e.g., `5432` or a custom port like `15432`)
- The host IP (your NAS IP on the local network)

### Create Database and User

Connect to the TrueNAS PostgreSQL instance:

```bash
# From your dev machine (adjust port if TrueNAS maps to a different one)
psql -h 192.168.1.241 -p 5432 -U dmp
# pw: 0yD33y5P801Hc8B0yvPa1$Ra!%5
```

Create the database:

```sql
CREATE USER dmp WITH PASSWORD 'your-secure-password';
CREATE DATABASE dmp OWNER dmp;
GRANT ALL PRIVILEGES ON DATABASE dmp TO dmp;
\q
```

### Verify Connectivity

```bash
psql postgresql://dmp:your-secure-password@192.168.1.241:5432/dmp -c "SELECT 1;"
```

## 2. NAS Storage Setup

Create directories for DMP data. The paths depend on your ZFS pool name (commonly `tank` or `pool`).

```bash
ssh nas

# Create app data directory
sudo mkdir -p /mnt/SSD/web/dmp/img/artists && sudo mkdir -p /mnt/SSD/web/dmp/img/releases && sudo mkdir -p /mnt/SSD/web/dmp/dump

# Set ownership to UID 999 (node user inside the container)
chown -R 999:999 /mnt/SSD/web/dmp
```

**Your music library** should already be on a ZFS dataset (e.g., `/mnt/dmp/music/mainstream`). Note the full path — you'll need it for the `.env` file.

## 3. Build Docker Images

On your **dev machine**:

```bash
cd /home/kp/web/DMPv6

# Build both images
web/scripts/deploy-docker.sh build
```

This builds:
- `dmp-web:latest` — the Nuxt web app (~800MB, includes mediasoup worker)
- `dmp-scripts:latest` — all Rust scripts: sync, analysis, clean, nuke (~50MB)

**Note**: The Dockerfile uses `node:20-bullseye` (Debian 11, OpenSSL 1.1.x) intentionally. TrueNAS Scale's Docker environment is detected by Prisma as requiring OpenSSL 1.1.x, so building on Bookworm (OpenSSL 3.0.x) causes a runtime mismatch even when both binary targets are included.

## 4. Transfer Images to NAS

### Option A: Using the deploy script

#### Setting up SSH key auth (recommended)

If you don't already have an SSH key for TrueNAS, set one up first:

**1. Generate a key pair on your dev machine**:

```bash
ssh-keygen -t ed25519 -C "sergio.castro.vale@gmail.com" -N ""  -f ~/.ssh/nas
```

**2. Add a block like this to ~/.ssh/config:**

```bash
  Host nas
      HostName 192.168.1.241
      User Kp
      IdentityFile ~/.ssh/nas
      IdentitiesOnly yes
```

**3. Refresh:**

```bash
 eval "$(ssh-agent -s)"
```

**4. Add the public key to TrueNAS Scale:**

In the TrueNAS web UI:
- Go to **Credentials > Local Users**
- Click on the `admin` user → **Edit**
- Scroll to **SSH Public Keys** and paste the contents of `~/.ssh/nas.pub`
- Click **Save**

**5. Make sure SSH service is enabled:**

In TrueNAS web UI, go to **System > Services**, find **SSH**, and ensure it is **Running** and set to **Start Automatically**.

---

Set these in your `web/.env`:

```env
SERVER_HOST=192.168.1.241
SERVER_USER=Kp
DEPLOY_PATH=/mnt/SSD/web/dmp
SSH_KEY_PATH=~/.ssh/nas   # omit this line to use password auth
```

Then run:

```bash
web/scripts/deploy-docker.sh push
```

## 5. Deploy

### Create `.env` on NAS

```bash
ssh nas
sudo nano /mnt/SSD/web/dmp/.env

# Paste this
DATABASE_URL=postgresql://dmp:0yD33y5P801Hc8B0yvPa1$$Ra!%5@host.docker.internal:5432/dmp?connection_limit=20&pool_timeout=10
MUSIC_DIR=/mnt/dmp/music/mainstream
DMP_DATA=/mnt/SSD/web/dmp
DMP_PORT=3000
PARTY_ENABLED=false
```

**Note on `DATABASE_URL`**: If PostgreSQL is running as a TrueNAS app (in Docker), use `host.docker.internal` or the NAS's actual LAN IP. Using `localhost` won't work since the DMP container has its own network namespace.

**Note on special characters**: Docker Compose interpolates `$VAR` in `.env` files. If your password contains `$`, escape it as `$$` (e.g. `$Ra` → `$$Ra`). Do not quote the value — Docker Compose does not strip quotes from `.env` files.

### Copy Compose File

```bash
# From your dev machine
scp docker-compose.yml nas:/mnt/SSD/web/dmp/
```

### Start the App

```bash
ssh nas
cd /mnt/SSD/web/dmp
docker compose up -d

# If permission errors: 
# sudo usermod -aG docker Kp && newgrp docker
```

### Verify

```bash
# Check container is running
docker ps

# Check health
docker inspect --format='{{.State.Health.Status}}' dmp-web

# Check logs
docker logs dmp-web

# Test the app
curl http://localhost:3000/api/stats
```

Access the web UI at `http://192.168.1.241:3000` from any device on your LAN.

## 6. Initial Data Load

You have two options: restore from an existing backup, or run a fresh index.

### Option A: Restore from Backup

Useful if you want a small test database.

On your dev machine:

```bash
cd web && pnpm backup   # Creates dump/YYYY-MM-DD-HH-MM-SS.sql.gz
```

Transfer and restore on NAS:

```bash
# Transfer the most recent dump
scp "dump/$(ls -t dump/ | head -1)" nas:/mnt/SSD/web/dmp/dump/

# SSH to NAS and restore
ssh nas
cd /mnt/SSD/web/dmp

# Drop and recreate the database
# If you need to find the name of the postgres app container:
# docker ps --format "{{.Names}}" | grep -i post
docker exec -it ix-postgres-postgres-1 psql -U dmp -d postgres -c "DROP DATABASE IF EXISTS dmp;"
docker exec -it ix-postgres-postgres-1 psql -U dmp -d postgres -c "CREATE DATABASE dmp OWNER dmp;"

# Restore
gunzip -c "dump/$(ls -t dump/ | head -1)" | docker exec -i ix-postgres-postgres-1 psql -U dmp -d dmp

# Restart the web app to pick up data
docker restart dmp-web
```

### Option B: Fresh Index

Run the index and sync scripts on the NAS. This is the recommended approach if you want the "production" database.

It will take several hours or days depending on the size of the DB.

```bash
ssh nas
cd /mnt/SSD/web/dmp

# Index + sync (full pipeline per artist)
docker run --rm \
  --env-file .env \
  -e MUSIC_DIR=/music \
  -e PROJECT_ROOT=/app \
  -v /mnt/SSD/media/music:/music:ro \
  -v /mnt/SSD/web/dmp/img:/app/web/public/img \
  dmp-scripts:latest dmp-sync
```

**Note**: The scripts use `PROJECT_ROOT/web/public/img/` to write cover art. The volume mount at `/app/web/public/img` maps to the shared image directory that the web container reads from via `/app/data/img`.

## 7. Running Scripts

All scripts run as ephemeral Docker containers sharing the same database and image storage.

```bash
# Common pattern: --env-file loads DB URL, volumes mount music + images
S="docker run --rm \
  --env-file /mnt/SSD/web/dmp/.env \
  -e PROJECT_ROOT=/app \
  -e MUSIC_DIR=/music \
  -v /mnt/SSD/media/music:/music:ro \
  -v /mnt/SSD/web/dmp/img:/app/web/public/img \
  dmp-scripts:latest"

# Sync (index + MusicBrainz match, full pipeline per artist)
$S dmp-sync
$S dmp-sync --resume                     # Resume from checkpoint
$S dmp-sync --only="Artist Name"         # Specific artist
$S dmp-sync --overwrite                  # Nuke + re-sync all

# Analysis (generate metadata report)
# Note: reports output to /app/reports inside the container
docker run --rm \
  --env-file /mnt/SSD/web/dmp/.env \
  -e MUSIC_DIR=/music \
  -v /mnt/SSD/media/music:/music:ro \
  -v /mnt/SSD/web/dmp/reports:/app/reports \
  dmp-scripts:latest dmp-analysis

# Clean (remove orphaned images)
$S dmp-clean
$S dmp-clean --dry-run

# Nuke (wipe database + images — DESTRUCTIVE)
$S dmp-nuke
```

**Tip**: Create shell aliases on TrueNAS for convenience:

```bash
cat >> ~/.bashrc << 'EOF'
alias dmp-sync='docker run --rm --env-file /mnt/SSD/web/dmp/.env -e PROJECT_ROOT=/app -e MUSIC_DIR=/music -v /mnt/SSD/media/music:/music:ro -v /mnt/SSD/web/dmp/img:/app/web/public/img dmp-scripts:latest dmp-sync'
alias dmp-clean='docker run --rm --env-file /mnt/SSD/web/dmp/.env -e PROJECT_ROOT=/app -v /mnt/SSD/web/dmp/img:/app/web/public/img dmp-scripts:latest dmp-clean'
alias dmp-nuke='docker run --rm --env-file /mnt/SSD/web/dmp/.env -e PROJECT_ROOT=/app -v /mnt/SSD/web/dmp/img:/app/web/public/img dmp-scripts:latest dmp-nuke'
EOF
```

## 8. Updating

When you make changes to the web app or scripts:

```bash
# On your dev machine — full rebuild + deploy
cd /home/kp/web/DMPv6
web/scripts/deploy-docker.sh

# Or just the web app
web/scripts/deploy-docker.sh web

# Or just the scripts
web/scripts/deploy-docker.sh scripts
```

## 9. Monitoring

```bash
# Container status
docker ps

# Logs (follow mode)
docker logs -f dmp-web

# Resource usage
docker stats dmp-web

# Health check
docker inspect --format='{{json .State.Health}}' dmp-web | python3 -m json.tool

# Restart
docker restart dmp-web
```

## 10. Tailscale Access

If you have Tailscale running on the NAS, you can access DMP from anywhere:

```
http://NAS_TAILSCALE_IP:3000
```

No SSL needed — Tailscale traffic is already encrypted end-to-end.

---

## Performance Optimizations

### PostgreSQL Tuning

The TrueNAS PostgreSQL app runs as container `ix-postgres-postgres-1`. Settings are applied via `ALTER SYSTEM SET` (writes to `postgresql.auto.conf` inside the container's data directory, so they survive container recreation) and require a full restart to take effect.

```bash
ssh nas

# Apply all settings — each ALTER SYSTEM must be its own statement
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

# Restart is required — shared_buffers and max_connections need it
docker restart ix-postgres-postgres-1

# Verify
docker exec ix-postgres-postgres-1 psql -U dmp -d dmp \
  -c 'SHOW shared_buffers; SHOW work_mem; SHOW max_connections; SHOW effective_cache_size;'
```

Values sized for 32GB RAM. If you ever rebuild the PostgreSQL app from scratch in TrueNAS UI, `postgresql.auto.conf` lives inside the app's persistent volume — check it survived with:

```bash
docker exec ix-postgres-postgres-1 cat /var/lib/postgresql/data/postgresql.auto.conf
```

### Redis API Cache

Redis runs as a sidecar container (`dmp-redis`) and caches responses for stats, genres, artists, timeline, and release endpoints — reducing repeated Prisma queries to sub-millisecond cache reads.

**NAS setup required before first deploy:**

```bash
ssh nas
mkdir -p /mnt/SSD/web/dmp/redis
```

The web container connects via `REDIS_URL=redis://dmp-redis:6379` (already set in `docker-compose.yml`). If Redis is unreachable the app silently falls through to the database — it is never a hard dependency.

See [docs/redis.md](redis.md) for full details on what is cached, TTLs, and invalidation logic.

### ZFS Tuning for Music Streaming

Music files are large sequential reads. The music library lives on the `dmp/music` dataset. Apply these properties from the NAS shell:

```bash
ssh nas

# Larger recordsize for sequential streaming (default is 128K)
sudo zfs set recordsize=1M dmp/music

# Stop large audio files from evicting useful metadata out of the ARC
sudo zfs set primarycache=metadata dmp/music

# Disable access time updates — saves a write on every file read
sudo zfs set atime=off dmp/music

# Verify
zfs get recordsize,primarycache,atime dmp/music
```

Expected output:
```
NAME       PROPERTY      VALUE     SOURCE
dmp/music  recordsize    1M        local
dmp/music  primarycache  metadata  local
dmp/music  atime         off       local
```

These properties are persistent across reboots and TrueNAS upgrades — no need to reapply unless the dataset is recreated.

The `SSD` pool holding PostgreSQL data should keep the defaults (`recordsize=128K`, `primarycache=all`) — random I/O benefits from smaller records and full ARC caching.
