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

/**
 * Wraps an async function with Redis caching.
 * Falls through to fn() if Redis is unavailable or not configured.
 */
export async function cachedResponse<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> {
  if (!redis) {return fn()}

  const fullKey = options.shared ? sharedCacheKey(await libraryVersion(), key) : key

  try {
    const cached = await redis.get(fullKey)
    if (cached) {return JSON.parse(cached) as T}
  }
  catch { /* ignore */ }

  const result = await fn()

  try {
    await redis.set(fullKey, JSON.stringify(result), 'EX', ttlSeconds)
  }
  catch { /* ignore */ }

  return result
}

export async function invalidateCache(pattern: string) {
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
