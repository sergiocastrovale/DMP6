import { redis } from './redis'

/**
 * Wraps an async function with Redis caching.
 * Falls through to fn() if Redis is unavailable or not configured.
 */
export async function cachedResponse<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (!redis) return fn()

  try {
    const cached = await redis.get(key)
    if (cached) return JSON.parse(cached) as T
  }
  catch { /* ignore */ }

  const result = await fn()

  try {
    await redis.set(key, JSON.stringify(result), 'EX', ttlSeconds)
  }
  catch { /* ignore */ }

  return result
}

export async function invalidateCache(pattern: string) {
  if (!redis) return
  try {
    const keys = await redis.keys(pattern)
    if (keys.length) await redis.del(...keys)
  }
  catch { /* ignore */ }
}
