import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/utils/redis', () => ({ redis: null }))
vi.mock('~/server/utils/libraryVersion', () => ({ libraryVersion: async () => 7 }))

const cache = await import('../../../server/utils/cache')

describe('cachedResponse without Redis', () => {
  beforeEach(() => {
    cache.resetMemoryCacheForTests()
    vi.useRealTimers()
  })

  it('serves repeated calls from the in-process cache', async () => {
    const fn = vi.fn().mockResolvedValue({ a: 1 })
    expect(await cache.cachedResponse('k', 60, fn)).toEqual({ a: 1 })
    expect(await cache.cachedResponse('k', 60, fn)).toEqual({ a: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('hands out copies, never the stored object', async () => {
    const first = await cache.cachedResponse<{ n: number }>('k', 60, async () => ({ n: 1 }))
    first.n = 99
    expect(await cache.cachedResponse<{ n: number }>('k', 60, async () => ({ n: 2 }))).toEqual({ n: 1 })
  })

  it('expires an entry after its TTL', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b')
    await cache.cachedResponse('k', 10, fn)
    vi.advanceTimersByTime(10_001)
    expect(await cache.cachedResponse('k', 10, fn)).toBe('b')
  })

  it('keeps at most 500 entries, dropping the least recently used', async () => {
    for (let i = 0; i < 500; i++) {
      await cache.cachedResponse(`k${i}`, 60, async () => i)
    }
    await cache.cachedResponse('k0', 60, async () => -1) // touch: now most recently used
    await cache.cachedResponse('extra', 60, async () => 'x') // evicts k1, not k0
    expect(await cache.cachedResponse('k0', 60, async () => -2)).toBe(0)
    expect(await cache.cachedResponse('k1', 60, async () => -3)).toBe(-3)
  })

  it('invalidateCache removes exact keys and glob matches', async () => {
    await cache.cachedResponse('user:1:a', 60, async () => 'a')
    await cache.cachedResponse('user:1:b', 60, async () => 'b')
    await cache.cachedResponse('user:2:a', 60, async () => 'c')
    await cache.invalidateCache('user:1:*')
    expect(await cache.cachedResponse('user:1:a', 60, async () => 'new')).toBe('new')
    expect(await cache.cachedResponse('user:2:a', 60, async () => 'new')).toBe('c')
  })

  it('shared entries are keyed to the library version and busted by invalidateShared', async () => {
    await cache.cachedResponse('artist:x', 60, async () => 'old', { shared: true })
    await cache.invalidateShared('artist:x')
    expect(await cache.cachedResponse('artist:x', 60, async () => 'new', { shared: true })).toBe('new')
  })
})

describe('singleflight', () => {
  beforeEach(() => {
    cache.resetMemoryCacheForTests()
  })

  it('runs the function once for concurrent misses and shares the result', async () => {
    let release: (v: string) => void = () => {}
    const fn = vi.fn(() => new Promise<string>((r) => { release = r }))
    const calls = Promise.all([cache.cachedResponse('hot', 60, fn), cache.cachedResponse('hot', 60, fn), cache.cachedResponse('hot', 60, fn)])
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
    release('done')
    expect(await calls).toEqual(['done', 'done', 'done'])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a failure reaches every waiter and is not cached', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    const results = await Promise.allSettled([cache.cachedResponse('bad', 60, fn), cache.cachedResponse('bad', 60, fn)])
    expect(results.every(r => r.status === 'rejected')).toBe(true)
    expect(await cache.cachedResponse('bad', 60, fn)).toBe('ok')
  })
})

describe('per-user cache version', () => {
  beforeEach(() => {
    cache.resetMemoryCacheForTests()
  })

  it('starts at 0 and bumps per user without touching others', async () => {
    expect(await cache.userCacheVersion(1)).toBe(0)
    await cache.bumpUserCache(1)
    await cache.bumpUserCache(1)
    expect(await cache.userCacheVersion(1)).toBe(2)
    expect(await cache.userCacheVersion(2)).toBe(0)
  })
})
