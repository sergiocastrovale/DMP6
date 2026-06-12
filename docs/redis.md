# Redis API Cache

DMP uses Redis as an optional server-side response cache. When available, repeated requests for expensive read-only API endpoints return pre-serialised JSON from Redis rather than re-running Prisma queries against PostgreSQL - taking reads from tens of milliseconds down to under a millisecond.

Redis is **optional and non-blocking**. If `REDIS_URL` is unset, or if the Redis instance is unreachable, every endpoint falls through transparently to the database. No request ever fails because of Redis.

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

The cache is **write-through**: a cache miss always populates Redis so the next identical request is served from cache.

---

## Implementation

### Singleton client - `server/utils/redis.ts`

A single `ioredis` instance is created at module load time if `REDIS_URL` is set. Key options:

| Option | Value | Reason |
|--------|-------|--------|
| `lazyConnect` | `true` | Don't block startup if Redis is slow |
| `maxRetriesPerRequest` | `1` | Fail fast on a bad connection rather than queuing |
| `enableOfflineQueue` | `false` | Discard commands when disconnected instead of buffering |
| `connectTimeout` | `2000ms` | Give up quickly so the app stays responsive |

Errors are silently swallowed via an `error` event listener - Redis never surfaces to the user.

### Cache helper - `server/utils/cache.ts`

```ts
cachedResponse<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T>
```

- If Redis is `null` (no `REDIS_URL`): calls `fn()` directly.
- Otherwise: tries `GET key`. On a hit, returns `JSON.parse`. On a miss, calls `fn()`, stores result with `SET key … EX ttlSeconds`, returns result.
- All Redis calls are wrapped in `try/catch` - a Redis error causes silent fallthrough to `fn()`.

```ts
invalidateCache(pattern: string): Promise<void>
```

Uses `KEYS pattern` to find matching keys, then `DEL`s them. Used for event-driven invalidation (see below). Pattern supports Redis glob syntax, e.g. `releases:last-played:*`.

---

## Cached endpoints

| Endpoint | Cache key | TTL | Notes |
|----------|-----------|-----|-------|
| `GET /api/stats` | `stats` | 5 min | Single stats row from the `Statistics` table |
| `GET /api/genres` | `genres` | 5 min | Full genre list with artist counts |
| `GET /api/artists` | `artists:p=…:ps=…:l=…:g=…:s=…:q=…:min=…:max=…` | 2 min | All browse filter params encoded in key |
| `GET /api/artists/[slug]` | `artist:{slug}` | 10 min | Artist metadata, genres, URLs |
| `GET /api/releases/latest` | `releases:latest:{limit}` | 2 min | Ordered by `createdAt DESC` |
| `GET /api/releases/last-played` | `releases:last-played:{limit}` | 1 min | Shorter TTL - changes on every play |
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

TTL expiry handles most staleness. A handful of write events also explicitly bust specific keys:

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

### Not explicitly invalidated

- `genres`, `artists:*`, `artist:{slug}` (non-play) - these only change after an index or sync run. Their TTLs (2–10 min) are short enough that stale data is not a practical concern.
- `releases:latest:*` - changes only when new releases are indexed. 2-min TTL is acceptable.

If you need to force-clear all DMP cache keys (e.g. after a full re-index), run on the NAS:

```bash
sudo docker exec dmp-redis redis-cli KEYS "dmp:*" | xargs sudo docker exec -i dmp-redis redis-cli DEL
# or wipe everything:
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

- **`maxmemory 512mb`** - hard cap. Tune up if you have RAM to spare; tune down on memory-constrained systems.
- **`allkeys-lru`** - when the cap is hit, evict the least recently used key regardless of TTL. Correct policy for a cache (as opposed to `noeviction` which is for a primary store).
- **Persistence** - Redis data is written to `${DMP_DATA}/redis` via the default RDB snapshot. Cache data survives container restarts; on a cold start cached values are available immediately.

The web container connects via `REDIS_URL=redis://dmp-redis:6379`. This is hardcoded in `docker-compose.yml` and does not need to be set in the NAS `.env`.

### Required NAS directory

Before the first deploy with Redis, create the data directory:

```bash
ssh nas
mkdir -p path/to/dmp/redis
```

---

## Local development

`REDIS_URL` is intentionally left empty in `web/.env`. Redis is not required to run DMP locally - all endpoints fall through to PostgreSQL as if Redis did not exist.

To test Redis locally, start a Redis container and set `REDIS_URL`:

```bash
docker run -d -p 6379:6379 redis:7-alpine
# then in web/.env:
REDIS_URL=redis://localhost:6379
```
