import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const redisMock = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK' }),
  del: vi.fn(async (...ks: string[]) => { for (const k of ks) {store.delete(k)}; return ks.length }),
  scan: vi.fn(async (_cursor: string, _m: string, pattern: string) => {
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    return ['0', [...store.keys()].filter(k => re.test(k))] as [string, string[]]
  }),
}
let version = 100
vi.mock('~/server/utils/redis', () => ({ redis: redisMock }))
vi.mock('~/server/utils/libraryVersion', () => ({ libraryVersion: async () => version }))

describe('cachedResponse with shared keys', () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
    version = 100
  })

  it('builds the key from the library version', async () => {
    const { sharedCacheKey } = await import('../../../server/utils/cache')
    expect(sharedCacheKey(123, 'stats')).toBe('lib:123:stats')
  })

  it('serves a shared entry until the library version changes, then recomputes', async () => {
    const { cachedResponse } = await import('../../../server/utils/cache')
    const fn = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    expect(await cachedResponse('k', 60, fn, { shared: true })).toBe('first')
    expect(await cachedResponse('k', 60, fn, { shared: true })).toBe('first')
    expect(fn).toHaveBeenCalledTimes(1)

    version = 101 // a scan ran
    expect(await cachedResponse('k', 60, fn, { shared: true })).toBe('second')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(store.has('lib:100:k')).toBe(true)
    expect(store.has('lib:101:k')).toBe(true)
  })

  it('leaves non-shared keys untouched by the library version', async () => {
    const { cachedResponse } = await import('../../../server/utils/cache')
    const fn = vi.fn().mockResolvedValue('v')
    await cachedResponse('user:1:k', 60, fn)
    version = 999
    await cachedResponse('user:1:k', 60, fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(store.has('user:1:k')).toBe(true)
  })

  it('invalidateShared busts the entry under every version', async () => {
    const { cachedResponse, invalidateShared } = await import('../../../server/utils/cache')
    await cachedResponse('artist:x', 60, async () => 'a', { shared: true })
    version = 101
    await cachedResponse('artist:x', 60, async () => 'b', { shared: true })
    await cachedResponse('artist:y', 60, async () => 'c', { shared: true })

    await invalidateShared('artist:x')

    expect([...store.keys()]).toEqual(['lib:101:artist:y'])
  })

  it('invalidateShared with a wildcard busts a whole family', async () => {
    const { cachedResponse, invalidateShared } = await import('../../../server/utils/cache')
    await cachedResponse('artists:p=1', 60, async () => 1, { shared: true })
    await cachedResponse('artists:p=2', 60, async () => 2, { shared: true })
    await cachedResponse('stats', 60, async () => 3, { shared: true })

    await invalidateShared('artists:*')

    expect([...store.keys()]).toEqual(['lib:100:stats'])
  })
})
