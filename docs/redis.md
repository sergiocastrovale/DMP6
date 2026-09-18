# Redis API Cache

Optional server-side response cache. Repeated requests for expensive read-only endpoints return pre-serialised JSON from Redis instead of re-running Prisma against PostgreSQL — tens of ms down to under 1ms.

**Optional and non-blocking.** `REDIS_URL` unset or unreachable → every endpoint falls through transparently to the DB. No request ever fails because of Redis.

---

## Architecture

```
Browser / client
      │
      ▼
Nuxt/Nitro server
      │
      ├─ cachedResponse(key, ttl, fn)
      │         │
      │    Redis HIT? ──────── yes ──► return JSON.parse(cached)
      │         │
      │        no
      │         │
      │         ▼
      │    fn() ── Prisma ──► PostgreSQL
      │         │
      │    redis.set(key, JSON.stringify(result), 'EX', ttl)
      │         │
      └─────────▼
           return result
```

**Write-through**: a cache miss always populates Redis, next identical request is served from cache.

---

## Implementation

### Singleton client - `server/utils/redis.ts`

Single `ioredis` instance created at module load if `REDIS_URL` is set:

| Option | Value | Reason |
|--------|-------|--------|
| `lazyConnect` | `true` | Don't block startup if Redis is slow |
| `maxRetriesPerRequest` | `1` | Fail fast on a bad connection rather than queuing |
| `enableOfflineQueue` | `false` | Discard commands when disconnected instead of buffering |
| `connectTimeout` | `2000ms` | Give up quickly so the app stays responsive |

Errors silently swallowed via an `error` event listener — Redis never surfaces to the user.

### Cache helper - `server/utils/cache.ts`

```ts
cachedResponse<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T>
```

- Redis `null` (no `REDIS_URL`) → calls `fn()` directly.
- Else: `GET key` — hit → `JSON.parse`; miss → `fn()`, `SET key … EX ttlSeconds`, return.
- All Redis calls wrapped `try/catch` — error → silent fallthrough to `fn()`.

```ts
invalidateCache(pattern: string): Promise<void>
```

`KEYS pattern` → `DEL`s matches. Used for event-driven invalidation (below). Glob syntax, e.g. `releases:last-played:*`.

---

## Cached endpoints

| Endpoint | Cache key | TTL | Notes |
|----------|-----------|-----|-------|
| `GET /api/stats` | `stats` | 5 min | Single stats row from the `Statistics` table |
| `GET /api/genres` | `genres:s=…:l=…` | 5 min | Genre list, most-common first; `search`/`limit` params encoded in key |
| `GET /api/artists` | `artists:p=…:ps=…:l=…:g=…:s=…:o=…:q=…:min=…:max=…` | 2 min | All browse filter params encoded in key; `g=` is a sorted, comma-joined genre list (OR match) |
| `GET /api/artists/[slug]` | `artist:{slug}` | 10 min | Artist metadata, genres, URLs |
| `GET /api/releases/latest` | `releases:latest:{limit}` | 2 min | Ordered by `createdAt DESC` |
| `GET /api/releases/last-played` | `releases:last-played:{limit}` | 1 min | Shorter TTL - changes on every play |
| `GET /api/releases/archive` | `releases:archive:pool` | 5 min | Pool the endpoint samples from |
| `GET /api/app-stats` | `app-stats` | 2 min | Dashboard counters |
| `GET /api/labs/map/countries` | `map:countries` | 24 h | Country aggregate, changes only after a sync |
| `GET /api/timeline/decades` | `timeline:decades` | 5 min | Reads from `dmp_timeline` materialized view |
| `GET /api/timeline/[decade]` | `timeline:{decade}:y=…:p=…:l=…` | 5 min | Year filter + pagination encoded in key |

Endpoints not cached (always hit the database):
- `/api/search` - query-unique, not worth caching
- `/api/artists/[slug]/releases` - paginated with infinite scroll, less benefit
- `/api/tracks/random`, `/api/tracks/random-batch` - intentionally random
- `/api/tracks/explore` - has its own in-memory pool cache in `server/utils/explore.ts`
- All write endpoints (POST, DELETE)
- `/api/audio/[id]` - file streaming, not JSON

---

## Cache invalidation

TTL expiry handles most staleness; a few write events also explicitly bust keys:

### On track play - `POST /api/tracks/[id]/play`

When a track is played, three caches are invalidated immediately:

| Pattern | Reason |
|---------|--------|
| `releases:last-played:*` | `lastPlayedAt` changed on the release |
| `stats` | `plays` counter incremented |
| `artist:{slug}` | `totalPlayCount` incremented on the artist |

### On timeline refresh - `POST /api/timeline/refresh`

After `REFRESH MATERIALIZED VIEW CONCURRENTLY dmp_timeline`, all timeline keys are busted:

| Pattern | Reason |
|---------|--------|
| `timeline:*` | Decade/year counts may have changed after index/sync |

### On artist add - `POST /api/artists/added/[mbid]`

`./add` writes straight to Postgres, can't reach Redis itself — `/add`'s Search.vue calls this route right after `./add` exits 0:

| Pattern | Reason |
|---------|--------|
| `artists:*` | New `manuallyAdded` artist should show in `/browse` immediately, not after the 2-min TTL |

### Not explicitly invalidated

- `genres`, `artists:*`, `artist:{slug}` (non-play) — only change after index/sync; TTLs (2-10 min) short enough stale data isn't a practical concern.
- `releases:latest:*` — changes only on new-release index, 2-min TTL acceptable.

If you need to force-clear all DMP cache keys (e.g. after a full re-index), run on the NAS:

```bash
# Keys are unprefixed (`stats`, `artist:{slug}`, …) and the instance is DMP's alone, so just wipe it:
sudo docker exec dmp-redis redis-cli FLUSHDB
```

---

## Docker Compose configuration

```yaml
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

Key settings:

- **`maxmemory 512mb`** — hard cap, tune to available RAM.
- **`allkeys-lru`** — cap hit → evict least-recently-used regardless of TTL (correct for a cache, vs. `noeviction` for a primary store).
- **Persistence** — written to `${DMP_DATA}/redis` via default RDB snapshot, survives container restarts.

Web container connects via `REDIS_URL=redis://dmp-redis:6379`, hardcoded in `docker-compose.yml` — not needed in NAS `.env`.

### Required NAS directory

Before the first deploy with Redis, create the data directory:

```bash
ssh nas
mkdir -p "$DEPLOY_PATH"/redis   # /mnt/SSD/web/dmp/redis
```

---

## Local development

`REDIS_URL` intentionally empty in `web/.env` — not required to run DMP locally, all endpoints fall through to PostgreSQL.

To test Redis locally, start a Redis container and set `REDIS_URL`:

```bash
docker run -d -p 6379:6379 redis:7-alpine
# then in web/.env:
REDIS_URL=redis://localhost:6379
```
