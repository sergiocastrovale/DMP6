import Redis from 'ioredis'

let _redis: Redis | null = null

if (process.env.REDIS_URL) {
  _redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  })
  _redis.on('error', () => { /* silently ignore — app works without Redis */ })
}

export const redis = _redis
