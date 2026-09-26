import { redis } from './redis'
import { libraryVersion } from './libraryVersion'

export interface CacheOptions {
  // Key the entry to the library version (server/utils/libraryVersion.ts): a scan, merge or any other
  // script run changes the version, so the entry is unreachable the moment the library changes instead of
  // serving stale data until its TTL runs out. Use for anything derived from the library; leave off for
  // per-user or purely external data.
  shared?: boolean
}

export const sharedCacheKey = (version: number, key: string): string => `lib:${version}:${key}`

// Without Redis the same entries live in a small in-process LRU, so a single-node install still stops
// recomputing every hot endpoint per request. Values are stored as JSON, like Redis, so a caller can never
// mutate what the next caller reads.
const MEMORY_MAX_ENTRIES = 500
const memory = new Map<string, { json: string, expiresAt: number }>()

const memoryGet = (key: string): string | null => {
  const entry = memory.get(key)
  if (!entry) {return null}
  memory.delete(key)
  if (entry.expiresAt <= Date.now()) {return null}
  memory.set(key, entry) // most recently used goes last
  return entry.json
}

const memorySet = (key: string, json: string, ttlSeconds: number): void => {
  memory.delete(key)
  memory.set(key, { json, expiresAt: Date.now() + ttlSeconds * 1000 })
  if (memory.size > MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next().value
    if (oldest !== undefined) {memory.delete(oldest)}
  }
}

const globToRegExp = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)

const readCache = async (key: string): Promise<string | null> => {
  if (!redis) {return memoryGet(key)}
  try {
    return await redis.get(key)
  }
  catch {
    return null
  }
}

const writeCache = async (key: string, json: string, ttlSeconds: number): Promise<void> => {
  if (!redis) {
    memorySet(key, json, ttlSeconds)
    return
  }
  try {
    await redis.set(key, json, 'EX', ttlSeconds)
  }
  catch { /* ignore */ }
}

// One computation per key at a time: N concurrent misses on a heavy endpoint share the first one's promise
// instead of each running the query.
const inflight = new Map<string, Promise<unknown>>()

/**
 * Wraps an async function with caching (Redis when configured, an in-process LRU otherwise) and singleflight.
 * Falls through to fn() when the cache is unreachable.
 */
export async function cachedResponse<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> {
  const fullKey = options.shared ? sharedCacheKey(await libraryVersion(), key) : key

  const running = inflight.get(fullKey)
  if (running) {return running as Promise<T>}

  const run = (async () => {
    const cached = await readCache(fullKey)
    if (cached) {
      try {
        return JSON.parse(cached) as T
      }
      catch { /* a corrupt entry is a miss */ }
    }
    const result = await fn()
    await writeCache(fullKey, JSON.stringify(result), ttlSeconds)
    return result
  })()

  inflight.set(fullKey, run)
  try {
    return await run
  }
  finally {
    inflight.delete(fullKey)
  }
}

export async function invalidateCache(pattern: string) {
  if (!pattern.includes('*')) {
    memory.delete(pattern)
  }
  else {
    const re = globToRegExp(pattern)
    for (const key of [...memory.keys()]) {
      if (re.test(key)) {memory.delete(key)}
    }
  }
  if (!redis) {return}
  try {
    if (!pattern.includes('*')) {
      await redis.del(pattern)
      return
    }
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = next
      if (keys.length) {await redis.del(...keys)}
    } while (cursor !== '0')
  }
  catch { /* ignore */ }
}

// Busts a shared (library-versioned) entry across every version. The web app's own mutations (artist photo,
// monitor toggle, ./add) change data without touching Statistics.updatedAt, so they still need an explicit
// bust; the `lib:*:` wildcard matches whichever version the entry was written under.
export const invalidateShared = (pattern: string) => invalidateCache(`lib:*:${pattern}`)

// Per-user cache generation. A user's entries embed it in their key, so "everything of this user's is stale"
// is one INCR instead of a keyspace SCAN on every counted play; the superseded keys just age out by TTL.
const userVersions = new Map<number, number>()

export const userCacheVersion = async (userId: number): Promise<number> => {
  if (!redis) {return userVersions.get(userId) ?? 0}
  try {
    return Number(await redis.get(`ver:user:${userId}`)) || 0
  }
  catch {
    return 0
  }
}

export const bumpUserCache = async (userId: number): Promise<void> => {
  userVersions.set(userId, (userVersions.get(userId) ?? 0) + 1)
  if (!redis) {return}
  try {
    await redis.incr(`ver:user:${userId}`)
  }
  catch { /* ignore */ }
}

// Test seam.
export const resetMemoryCacheForTests = (): void => {
  memory.clear()
  inflight.clear()
  userVersions.clear()
}
