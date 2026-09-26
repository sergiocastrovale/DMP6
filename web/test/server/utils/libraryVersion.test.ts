import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUnique = vi.fn()
vi.mock('~/server/utils/prisma', () => ({ prisma: { statistics: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))

describe('libraryVersion', () => {
  beforeEach(async () => {
    findUnique.mockReset()
    const { _resetLibraryVersionForTest } = await import('../../../server/utils/libraryVersion')
    _resetLibraryVersionForTest()
  })

  it('is the epoch ms of Statistics.updatedAt', async () => {
    findUnique.mockResolvedValue({ updatedAt: new Date(1_750_000_000_000) })
    const { libraryVersion } = await import('../../../server/utils/libraryVersion')
    expect(await libraryVersion(1000)).toBe(1_750_000_000_000)
  })

  it('is 0 when the Statistics row does not exist yet', async () => {
    findUnique.mockResolvedValue(null)
    const { libraryVersion } = await import('../../../server/utils/libraryVersion')
    expect(await libraryVersion(1000)).toBe(0)
  })

  it('reads the database at most once per TTL window and re-reads after it', async () => {
    findUnique.mockResolvedValueOnce({ updatedAt: new Date(1) }).mockResolvedValueOnce({ updatedAt: new Date(2) })
    const { libraryVersion } = await import('../../../server/utils/libraryVersion')
    expect(await libraryVersion(10_000)).toBe(1)
    expect(await libraryVersion(12_000)).toBe(1)
    expect(await libraryVersion(16_000)).toBe(2)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  it('shares one query between concurrent callers', async () => {
    findUnique.mockResolvedValue({ updatedAt: new Date(5) })
    const { libraryVersion } = await import('../../../server/utils/libraryVersion')
    const results = await Promise.all([libraryVersion(1), libraryVersion(1), libraryVersion(1)])
    expect(results).toEqual([5, 5, 5])
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  it('serves the last known version when a refresh fails instead of throwing', async () => {
    findUnique.mockResolvedValueOnce({ updatedAt: new Date(7) }).mockRejectedValueOnce(new Error('db down'))
    const { libraryVersion } = await import('../../../server/utils/libraryVersion')
    expect(await libraryVersion(1000)).toBe(7)
    expect(await libraryVersion(20_000)).toBe(7)
  })
})
