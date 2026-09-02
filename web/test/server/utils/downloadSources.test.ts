import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadSourceConfigItem } from '../../../types/download'

const prismaMocks = vi.hoisted(() => ({
  upsert: vi.fn().mockResolvedValue(undefined),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
  queryRaw: vi.fn(),
}))

vi.mock('~/server/utils/prisma', () => ({
  prisma: {
    downloadSourceConfig: {
      upsert: prismaMocks.upsert,
      findMany: prismaMocks.findMany,
      findUnique: prismaMocks.findUnique,
      update: prismaMocks.update,
    },
    $queryRaw: prismaMocks.queryRaw,
  },
}))

const {
  chooseSource, RT_PRIORITY, SLSK_PRIORITY, RT_DAILY_BUDGET,
  ensureDownloadSources, getDownloadSources, invalidateDownloadSourcesCache,
  rtBudgetAvailable, exhaustRtBudget, downloadWorkPossible, countNoYearMissing,
  getAcquisitionStatus, consumeRtBudget,
} = await import('../../../server/utils/downloadSources')

const configs = (overrides: Partial<Record<'RUTRACKER' | 'SLSKD', Partial<DownloadSourceConfigItem>>> = {}): DownloadSourceConfigItem[] => [
  { name: 'RUTRACKER', url: 'https://rutracker.org', retry: false, enabled: true, ...overrides.RUTRACKER },
  { name: 'SLSKD', url: null, retry: true, enabled: true, ...overrides.SLSKD },
]

describe('chooseSource', () => {
  it('picks RuTracker first at fresh priority when enabled, untried, and budget ok', () => {
    expect(chooseSource(RT_PRIORITY, [], configs())).toBe('RUTRACKER')
  })

  it('falls through to Soulseek once priority drops to the SLSK band', () => {
    expect(chooseSource(SLSK_PRIORITY, [], configs())).toBe('SLSKD')
  })

  it('falls through to Soulseek when RuTracker was already tried', () => {
    expect(chooseSource(RT_PRIORITY, ['RUTRACKER'], configs())).toBe('SLSKD')
  })

  it('falls through to Soulseek (without marking RT tried) when the RT budget is exhausted', () => {
    expect(chooseSource(RT_PRIORITY, [], configs(), false)).toBe('SLSKD')
  })

  it('skips RuTracker when disabled', () => {
    expect(chooseSource(RT_PRIORITY, [], configs({ RUTRACKER: { enabled: false } }))).toBe('SLSKD')
  })

  it('returns null when both sources are disabled', () => {
    expect(chooseSource(RT_PRIORITY, [], configs({ RUTRACKER: { enabled: false }, SLSKD: { enabled: false } }))).toBeNull()
  })

  it('returns null when priority is in the SLSK band and Soulseek is disabled', () => {
    expect(chooseSource(SLSK_PRIORITY, [], configs({ SLSKD: { enabled: false } }))).toBeNull()
  })

  it('never re-tries RuTracker once tried, even at fresh priority and budget ok', () => {
    expect(chooseSource(RT_PRIORITY, ['RUTRACKER'], configs())).toBe('SLSKD')
  })
})

describe('ensureDownloadSources / getDownloadSources', () => {
  beforeEach(() => {
    invalidateDownloadSourcesCache()
    vi.clearAllMocks()
  })

  it('upserts both default source rows', async () => {
    await ensureDownloadSources()

    expect(prismaMocks.upsert).toHaveBeenCalledTimes(2)
    expect(prismaMocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { name: 'RUTRACKER' } }))
  })

  it('seeds defaults when the table is empty, then re-reads', async () => {
    prismaMocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: 'RUTRACKER', url: 'https://rutracker.org', retry: false, enabled: true }])

    const result = await getDownloadSources()

    expect(prismaMocks.upsert).toHaveBeenCalled()
    expect(result).toEqual([{ name: 'RUTRACKER', url: 'https://rutracker.org', retry: false, enabled: true }])
  })

  it('serves from cache within the TTL, without a second DB read', async () => {
    prismaMocks.findMany.mockResolvedValue([{ name: 'SLSKD', url: null, retry: true, enabled: true }])

    await getDownloadSources()
    await getDownloadSources()

    expect(prismaMocks.findMany).toHaveBeenCalledTimes(1)
  })

  it('falls back to in-memory defaults when the DB read throws', async () => {
    prismaMocks.findMany.mockRejectedValue(new Error('db down'))

    const result = await getDownloadSources()

    expect(result.map(r => r.name)).toEqual(['RUTRACKER', 'SLSKD'])
  })
})

describe('RuTracker budget', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports full budget when no row exists', async () => {
    prismaMocks.findUnique.mockResolvedValue(null)

    expect(await rtBudgetAvailable()).toBe(true)
  })

  it('reports unavailable once the window budget is spent', async () => {
    prismaMocks.findUnique.mockResolvedValue({ budgetWindowStart: new Date(), budgetUsed: RT_DAILY_BUDGET })

    expect(await rtBudgetAvailable()).toBe(false)
  })

  it('resets once the 24h window has elapsed', async () => {
    prismaMocks.findUnique.mockResolvedValue({
      budgetWindowStart: new Date(Date.now() - 25 * 60 * 60 * 1000),
      budgetUsed: RT_DAILY_BUDGET,
    })

    expect(await rtBudgetAvailable()).toBe(true)
  })

  it('exhaustRtBudget forces budgetUsed to the daily cap', async () => {
    await exhaustRtBudget()

    expect(prismaMocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ budgetUsed: RT_DAILY_BUDGET }),
    }))
  })

  it('exhaustRtBudget swallows a failed update', async () => {
    prismaMocks.update.mockRejectedValueOnce(new Error('db down'))

    await expect(exhaustRtBudget()).resolves.toBeUndefined()
  })

  it('consumeRtBudget starts a fresh window when none is active', async () => {
    prismaMocks.findUnique.mockResolvedValue(null)

    await consumeRtBudget()

    expect(prismaMocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ budgetUsed: 1 }),
    }))
  })

  it('consumeRtBudget increments within an active window', async () => {
    prismaMocks.findUnique.mockResolvedValue({ budgetWindowStart: new Date(), budgetUsed: 3 })

    await consumeRtBudget()

    expect(prismaMocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { budgetUsed: { increment: 1 } },
    }))
  })
})

describe('downloadWorkPossible', () => {
  beforeEach(() => {
    invalidateDownloadSourcesCache()
    vi.clearAllMocks()
  })

  it('is true when Soulseek is enabled', async () => {
    prismaMocks.findMany.mockResolvedValue([
      { name: 'RUTRACKER', url: null, retry: false, enabled: false },
      { name: 'SLSKD', url: null, retry: true, enabled: true },
    ])

    expect(await downloadWorkPossible()).toBe(true)
  })

  it('is true when only RuTracker is enabled and budget remains', async () => {
    prismaMocks.findMany.mockResolvedValue([
      { name: 'RUTRACKER', url: null, retry: false, enabled: true },
      { name: 'SLSKD', url: null, retry: true, enabled: false },
    ])
    prismaMocks.findUnique.mockResolvedValue(null)

    expect(await downloadWorkPossible()).toBe(true)
  })

  it('is false when both sources are disabled', async () => {
    prismaMocks.findMany.mockResolvedValue([
      { name: 'RUTRACKER', url: null, retry: false, enabled: false },
      { name: 'SLSKD', url: null, retry: true, enabled: false },
    ])

    expect(await downloadWorkPossible()).toBe(false)
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
  beforeEach(() => {
    invalidateDownloadSourcesCache()
    vi.clearAllMocks()
  })

  it('summarizes acquisition eligibility and the RuTracker budget window', async () => {
    prismaMocks.findMany.mockResolvedValue([
      { name: 'RUTRACKER', url: null, retry: false, enabled: true },
      { name: 'SLSKD', url: null, retry: true, enabled: false },
    ])
    prismaMocks.findUnique.mockResolvedValue({ budgetWindowStart: new Date(), budgetUsed: 3 })
    prismaMocks.queryRaw.mockResolvedValue([{ count: 2n }])

    const status = await getAcquisitionStatus()

    expect(status.canAcquire).toBe(true)
    expect(status.rt).toMatchObject({ enabled: true, used: 3, limit: RT_DAILY_BUDGET, remaining: RT_DAILY_BUDGET - 3 })
    expect(status.slsk).toEqual({ enabled: false })
    expect(status.noYearMissing).toBe(2)
    expect(status.rt.resetsAt).not.toBeNull()
  })

  it('is not acquirable when RuTracker is disabled and Soulseek is off', async () => {
    prismaMocks.findMany.mockResolvedValue([
      { name: 'RUTRACKER', url: null, retry: false, enabled: false },
      { name: 'SLSKD', url: null, retry: true, enabled: false },
    ])
    prismaMocks.findUnique.mockResolvedValue(null)
    prismaMocks.queryRaw.mockRejectedValue(new Error('db down'))

    const status = await getAcquisitionStatus()

    expect(status.canAcquire).toBe(false)
    expect(status.rt.resetsAt).toBeNull()
    expect(status.noYearMissing).toBe(0)
  })
})
