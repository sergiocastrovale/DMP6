import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  queryRaw: vi.fn(),
}))

vi.mock('~/server/utils/prisma', () => ({
  prisma: {
    settings: {
      findUnique: prismaMocks.findUnique,
    },
    $queryRaw: prismaMocks.queryRaw,
  },
}))

const { isDownloadsEnabled, countNoYearMissing, getAcquisitionStatus } = await import('../../../server/utils/acquisitionStatus')

describe('isDownloadsEnabled', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is true when Settings.downloadsEnabled is null (default)', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: null })
    expect(await isDownloadsEnabled()).toBe(true)
  })

  it('is true when Settings.downloadsEnabled is explicitly true', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: true })
    expect(await isDownloadsEnabled()).toBe(true)
  })

  it('is false when Settings.downloadsEnabled is explicitly false', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: false })
    expect(await isDownloadsEnabled()).toBe(false)
  })

  it('defaults to true when the Settings row is missing or the read throws', async () => {
    prismaMocks.findUnique.mockResolvedValue(null)
    expect(await isDownloadsEnabled()).toBe(true)

    prismaMocks.findUnique.mockRejectedValue(new Error('db down'))
    expect(await isDownloadsEnabled()).toBe(true)
  })
})

describe('countNoYearMissing', () => {
  it('returns the raw query count as a number', async () => {
    prismaMocks.queryRaw.mockResolvedValue([{ count: 7n }])
    expect(await countNoYearMissing()).toBe(7)
  })

  it('returns 0 when the query yields no rows', async () => {
    prismaMocks.queryRaw.mockResolvedValue([])
    expect(await countNoYearMissing()).toBe(0)
  })
})

describe('getAcquisitionStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('summarizes acquisition eligibility when downloads are enabled', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: true })
    prismaMocks.queryRaw.mockResolvedValue([{ count: 2n }])

    const status = await getAcquisitionStatus()

    expect(status).toEqual({ canAcquire: true, enabled: true, noYearMissing: 2 })
  })

  it('is not acquirable when downloads are disabled', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: false })
    prismaMocks.queryRaw.mockRejectedValue(new Error('db down'))

    const status = await getAcquisitionStatus()

    expect(status).toEqual({ canAcquire: false, enabled: false, noYearMissing: 0 })
  })
})
