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
# pw: 0%yD33y5P80@1Hc8^B*0yv%Pa1$Ra!%5
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
- `dmp-scripts:latest` — all Rust scripts: index, sync, analysis, clean, nuke (~50MB)

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
DATABASE_URL=postgresql://dmp:0%yD33y5P80@1Hc8^B*0yv%Pa1$$Ra!%5@host.docker.internal:5432/dmp
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

# Index your music library
docker run --rm \
  --env-file .env \
  -e MUSIC_DIR=/music \
  -e PROJECT_ROOT=/app \
  -v /mnt/SSD/media/music:/music:ro \
  -v /mnt/SSD/web/dmp/img:/app/web/public/img \
  dmp-scripts:latest dmp-index

# Sync against MusicBrainz
docker run --rm \
  --env-file .env \
  -e PROJECT_ROOT=/app \
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
  -v /mnt/SSD/media/music:/music:ro \
  -v /mnt/SSD/web/dmp/img:/app/web/public/img \
  dmp-scripts:latest"

# Index (scan music directory)
$S dmp-index
$S dmp-index --resume                    # Resume interrupted index
$S dmp-index --only="Artist Name"        # Index specific artist

# Sync (match against MusicBrainz)
$S dmp-sync
$S dmp-sync --overwrite                  # Re-sync all

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
alias dmp-index='docker run --rm --env-file /mnt/SSD/web/dmp/.env -e PROJECT_ROOT=/app -e MUSIC_DIR=/music -v /mnt/SSD/media/music:/music:ro -v /mnt/SSD/web/dmp/img:/app/web/public/img dmp-scripts:latest dmp-index'
alias dmp-sync='docker run --rm --env-file /mnt/SSD/web/dmp/.env -e PROJECT_ROOT=/app -v /mnt/SSD/web/dmp/img:/app/web/public/img dmp-scripts:latest dmp-sync'
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

## Phase 2: Performance Optimizations

At 12k+ artists, 150k+ releases, and 2.5M+ tracks, several optimizations become important. Split into infrastructure (NAS) and application (dev project) changes.

### NAS Infrastructure

#### PostgreSQL Tuning

Apply to the TrueNAS PostgreSQL app configuration. Values for 32GB RAM:

```
# Memory
shared_buffers = 8GB              # 25% of 32GB
effective_cache_size = 24GB       # 75% of 32GB
work_mem = 256MB                  # Personal app = few concurrent queries, go big
maintenance_work_mem = 2GB        # Faster VACUUM/index builds

# Write performance
wal_buffers = 64MB
checkpoint_completion_target = 0.9
min_wal_size = 1GB
max_wal_size = 4GB

# Query planner
random_page_cost = 1.1            # SSD/NVMe storage
effective_io_concurrency = 200    # SSD/NVMe

# Parallelism
max_worker_processes = 8
max_parallel_workers = 8
max_parallel_workers_per_gather = 4

# Connections — personal app, keep low to preserve work_mem budget
max_connections = 50
```

#### Redis API Cache

Add Redis to `docker-compose.yml` for server-side API response caching:

```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: dmp-redis
    restart: unless-stopped
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - ${DMP_DATA}/redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
```

Target cache TTLs:

| Route | TTL | Reason |
|-------|-----|--------|
| `/api/stats` | 5 min | Aggregate counts, rarely change |
| `/api/genres/*` | 5 min | Genre list is stable |
| `/api/artists/basic` | 5 min | Browse list, updated on index/sync |
| `/api/artists/proximity-data` | 5 min | 3D view data, heavy query |
| `/api/timeline/*` | 5 min | Decade groupings, stable |
| `/api/releases/latest` | 2 min | Recently added |
| `/api/releases/last-played` | 2 min | Recently played |
| `/api/artists/[slug]` | 10 min | Artist detail, heavy with all releases |

#### ZFS Tuning for Music Streaming

Music files are large sequential reads. Tune the ZFS dataset holding your library:

```bash
# Larger recordsize for sequential streaming (default is 128K)
zfs set recordsize=1M mnt/dmp/music

# Prioritize metadata caching over file data in ARC (files are too large to cache)
zfs set primarycache=metadata mnt/dmp/music

# Disable access time updates — saves a write on every file read
zfs set atime=off mnt/dmp/music
```

The SSD pool holding PostgreSQL data benefits from the opposite — keep the default `recordsize=128K` and `primarycache=all`.

#### Image CDN / Caching

For serving 12k+ artist images and 150k+ release covers efficiently:

1. **S3 offload** (current): `IMAGE_STORAGE=s3` serves images from S3 — zero NAS I/O for images
2. **Browser cache**: The image middleware already sets `Cache-Control: public, max-age=31536000, immutable` (1 year)
3. **CloudFront** (optional): Put a CDN in front of the S3 bucket for global edge caching

---

### Dev Project

#### Database Indexes ✅

Add to `web/prisma/schema.prisma` for queries that become slow at scale:

```prisma
// === Artist model ===
@@index([totalPlayCount])       // Browse sort by play count
@@index([averageMatchScore])    // Browse sort by match score
@@index([createdAt])            // Browse sort by recently added

// === LocalRelease model ===
@@index([year])                 // Timeline decade grouping
@@index([createdAt])            // Latest releases endpoint
@@index([lastPlayedAt])         // Last-played releases endpoint

// === LocalReleaseTrack model ===
@@index([year])                 // Explore era pre-filter, timeline
@@index([year, genre])          // Explore composite era+genre filter
@@index([playCount])            // Explore familiarity scoring
@@index([lastPlayedAt])         // Last-played track queries
@@index([genre])                // Genre filtering
```

Then apply:

```bash
cd web && pnpm db:push
```

#### Full-Text Search with pg_trgm ✅

The search endpoint uses `LIKE '%query%'` which causes full table scans at 2.5M tracks. Enable trigram indexes:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN indexes for fast substring search
CREATE INDEX idx_artist_name_trgm ON "Artist" USING GIN (name gin_trgm_ops);
CREATE INDEX idx_local_release_title_trgm ON "LocalRelease" USING GIN (title gin_trgm_ops);
CREATE INDEX idx_local_release_track_title_trgm ON "LocalReleaseTrack" USING GIN (title gin_trgm_ops);
```

These indexes support Prisma's `contains` + `mode: 'insensitive'` queries with no code changes — PostgreSQL automatically uses the GIN index for case-insensitive `LIKE` patterns.

#### Random Track Selection (Catalogue Shuffle) ✅

**Problem**: `/api/tracks/random` uses `COUNT + skip(random offset)`. At 2.5M tracks, `COUNT(*)` alone is ~200ms, plus the `OFFSET` scan. Every song transition in catalogue shuffle triggers this.

**Solution**: Use `TABLESAMPLE` via Prisma `$queryRaw`:

```ts
// Near-instant random selection — O(1) regardless of table size
const [track] = await prisma.$queryRaw`
  SELECT id, title, duration, genre, year, "localReleaseId"
  FROM "LocalReleaseTrack"
  TABLESAMPLE BERNOULLI(0.01)
  LIMIT 1
`;
```

`TABLESAMPLE BERNOULLI(0.01)` samples ~0.01% of pages randomly. At 2.5M rows this reliably returns results. If empty (rare), fall back to `BERNOULLI(0.1)`.

#### Batch Random Track Pre-fetching ✅

**Problem**: Catalogue shuffle fetches 1 track at a time from `/api/tracks/random`. Each song transition blocks on a network round-trip + DB query.

**Solution**: Add `/api/tracks/random-batch` that returns N tracks at once:

```ts
// Fetch 10 random tracks in a single query
const tracks = await prisma.$queryRaw`
  SELECT id, title, duration, genre, year, "localReleaseId"
  FROM "LocalReleaseTrack"
  TABLESAMPLE BERNOULLI(0.05)
  LIMIT 10
`;
```

On the client, pre-fetch the next batch when the queue drops below 3 tracks. This eliminates the per-song latency entirely.

#### Explore Candidate Pool Caching ✅

**Problem**: `/api/tracks/explore` fetches 500 candidates per request, scores them, and returns 1 track. At 2.5M tracks, this is 500 rows loaded + scored for every single song transition.

**Solution**: Cache the candidate pool server-side (in-memory or Redis) keyed by the explore slider parameters. Subsequent requests with the same params draw from the cached pool until exhausted, then refetch.

```ts
// Key: hash of energy+era+familiarity+sound params
// Value: array of pre-scored track IDs
// TTL: 5 minutes or until pool exhausted
```

This turns 500-row-fetch-per-song into 500-row-fetch-per-session.

#### HTTP Response Caching Headers

**Problem**: No API endpoints set `Cache-Control` headers. Every page load triggers fresh DB queries, even for data that changes rarely (stats, genres, timeline).

**Solution**: Add `Cache-Control` headers to stable endpoints:

```ts
// In each endpoint handler:
setResponseHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
```

| Route | `max-age` | Rationale |
|-------|-----------|-----------|
| `/api/stats` | 300s | Aggregates, change on index/sync only |
| `/api/genres` | 300s | Genre list is stable |
| `/api/timeline/*` | 300s | Decade groupings are stable |
| `/api/artists?sort=name` | 120s | Browse order rarely changes |
| `/api/releases/latest` | 60s | Recently added, moderate churn |
| `/api/releases/last-played` | 30s | Changes on every play |
| `/api/audio/*` | 86400s | Audio files are immutable |

This reduces DB load to zero for repeat visits within the TTL window — no Redis required for these cases.

#### Audio Streaming: Accept-Ranges Optimization

The audio endpoint already supports range requests. Two additional optimizations:

1. **Set `Cache-Control` on audio responses**: Audio files never change — cache aggressively:
   ```ts
   setResponseHeader(event, 'Cache-Control', 'public, max-age=86400, immutable');
   ```

2. **Add `ETag` based on file mtime + size**: Allows conditional requests (`If-None-Match`) so the browser skips re-downloading entirely:
   ```ts
   const etag = `"${stat.size}-${stat.mtimeMs}"`;
   setResponseHeader(event, 'ETag', etag);
   if (getRequestHeader(event, 'if-none-match') === etag) {
     return sendNoContent(event, 304);
   }
   ```

#### Prisma Connection Pool Sizing

**Problem**: Default Prisma pool is 10 connections. With `work_mem=256MB`, that's up to 2.5GB RAM if all connections sort simultaneously.

**Solution**: Tune via `DATABASE_URL` query param:

```
DATABASE_URL=postgresql://...?connection_limit=20&pool_timeout=10
```

20 connections is plenty for a personal app and stays well within the `max_connections=50` PostgreSQL limit while leaving room for scripts and Prisma Studio.

#### Materialized Views for Stats & Timeline

**Problem**: `/api/stats` runs multiple `COUNT(*)` queries across large tables on every request. `/api/timeline/*` groups 2.5M tracks by year/decade.

**Solution**: Create materialized views that are refreshed after index/sync runs:

```sql
-- Aggregate stats, refreshed after index/sync
CREATE MATERIALIZED VIEW dmp_stats AS
SELECT
  (SELECT COUNT(*) FROM "Artist") AS artist_count,
  (SELECT COUNT(*) FROM "LocalRelease") AS release_count,
  (SELECT COUNT(*) FROM "LocalReleaseTrack") AS track_count,
  (SELECT COUNT(DISTINCT genre) FROM "LocalReleaseTrack" WHERE genre IS NOT NULL) AS genre_count;

CREATE UNIQUE INDEX ON dmp_stats (artist_count); -- required for CONCURRENTLY

-- Decade/year aggregation for timeline
CREATE MATERIALIZED VIEW dmp_timeline AS
SELECT
  (EXTRACT(YEAR FROM make_date(year, 1, 1)) / 10 * 10)::int AS decade,
  year,
  COUNT(*) AS track_count,
  COUNT(DISTINCT "localReleaseId") AS release_count
FROM "LocalReleaseTrack"
WHERE year IS NOT NULL AND year > 0
GROUP BY year;

CREATE INDEX ON dmp_timeline (decade, year);

-- Refresh after index/sync
REFRESH MATERIALIZED VIEW CONCURRENTLY dmp_stats;
REFRESH MATERIALIZED VIEW CONCURRENTLY dmp_timeline;
```

Query these views instead of running aggregations in real-time. Goes from seconds to <1ms.

#### Artist Detail Page: Paginate Releases

**Problem**: `/api/artists/[slug]` loads ALL releases + tracks for an artist with no limit. Artists with 100+ releases return massive payloads and trigger expensive JOINs.

**Solution**: Paginate releases (default 20), lazy-load the rest on scroll:

```ts
// Initial load: first 20 releases
const releases = await prisma.localRelease.findMany({
  where: { tracks: { some: { trackArtists: { some: { artistId } } } } },
  take: 20,
  orderBy: { year: 'desc' },
  select: { /* minimal fields */ },
});
```

#### Favorites: Add Pagination

**Problem**: `/api/favorites` loads ALL favorite releases and tracks with no limit. Unbounded as the user adds more favorites.

**Solution**: Add `limit` and `offset` query params, default `limit=50`.

#### Queue Persistence: Limit Stored Tracks

**Problem**: `localStorage` stores the entire queue. With catalogue shuffle, the queue grows unbounded as tracks play. At some point this degrades `JSON.parse` on page load.

**Solution**: Cap stored queue to ~200 tracks. Drop oldest entries when the cap is hit. The player already re-fetches random tracks, so there's no loss.
