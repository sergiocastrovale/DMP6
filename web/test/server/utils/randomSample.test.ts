import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  _resetSampleCacheForTest,
  SAMPLE_ESCALATION,
  sampleIds,
  samplePercent,
} from '../../../server/utils/randomSample'

describe('samplePercent', () => {
  it('samples n x 40 rows worth of pages', () => {
    // 500 candidates out of 2M rows: 20,000 rows = 1%.
    expect(samplePercent(500, 2_000_000)).toBeCloseTo(1, 5)
    expect(samplePercent(1, 2_000_000)).toBeCloseTo(0.002, 6)
  })

  it('scales with the escalation multiplier and never exceeds 100', () => {
    expect(samplePercent(500, 2_000_000, SAMPLE_ESCALATION)).toBeCloseTo(8, 5)
    expect(samplePercent(500, 10_000)).toBe(100)
  })

  it('never returns 0 (a 0% sample is always empty) and samples everything when the row count is unknown', () => {
    expect(samplePercent(1, 1e12)).toBeGreaterThan(0)
    expect(samplePercent(5, 0)).toBe(100)
    expect(samplePercent(5, -1)).toBe(100)
  })
})

const fakePrisma = (results: unknown[][]) => {
  const queryRaw = vi.fn()
  for (const r of results) {queryRaw.mockImplementationOnce(() => Promise.resolve(r))}
  return { $queryRaw: queryRaw } as unknown as PrismaClient & { $queryRaw: ReturnType<typeof vi.fn> }
}

describe('sampleIds', () => {
  beforeEach(() => _resetSampleCacheForTest())

  it('returns the first sample when it already has n rows', async () => {
    const prisma = fakePrisma([[{ rows: 2_000_000 }], [{ id: 'a' }, { id: 'b' }]])
    expect(await sampleIds(prisma, 'LocalReleaseTrack', 2)).toEqual(['a', 'b'])
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('escalates the sample size when a selective filter leaves it short', async () => {
    const prisma = fakePrisma([[{ rows: 2_000_000 }], [{ id: 'a' }], [{ id: 'a' }, { id: 'b' }, { id: 'c' }]])
    expect(await sampleIds(prisma, 'LocalReleaseTrack', 3)).toEqual(['a', 'b', 'c'])
  })

  it('falls back to a plain ORDER BY random() after the escalations', async () => {
    const prisma = fakePrisma([[{ rows: 2_000_000 }], [], [], [], [{ id: 'x' }, { id: 'y' }]])
    expect(await sampleIds(prisma, 'LocalReleaseTrack', 2)).toEqual(['x', 'y'])
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(5)
  })

  it('stops as soon as it has sampled 100% - a short result then means the table is simply small', async () => {
    const prisma = fakePrisma([[{ rows: 10 }], [{ id: 'only' }]])
    expect(await sampleIds(prisma, 'Artist', 5)).toEqual(['only'])
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('caches the row estimate between calls', async () => {
    const prisma = fakePrisma([[{ rows: 2_000_000 }], [{ id: 'a' }], [{ id: 'b' }]])
    await sampleIds(prisma, 'LocalRelease', 1, undefined, 1000)
    await sampleIds(prisma, 'LocalRelease', 1, undefined, 2000)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3)
  })

  it('returns nothing for n <= 0 without touching the database', async () => {
    const prisma = fakePrisma([])
    expect(await sampleIds(prisma, 'Artist', 0)).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})
