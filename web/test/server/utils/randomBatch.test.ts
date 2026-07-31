import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { fetchRandomTrackRows } from '../../../server/utils/randomBatch'

const row = (id: string) => ({ id, title: 't', artist: 'a', album: 'al', duration: 100, localReleaseId: null })

const fakePrisma = (results: unknown[][]): PrismaClient => {
  const queryRaw = vi.fn()
  for (const r of results) {queryRaw.mockImplementationOnce(() => Promise.resolve(r))}
  return { $queryRaw: queryRaw } as unknown as PrismaClient
}

describe('fetchRandomTrackRows', () => {
  it('returns the first-tier BERNOULLI(0.05) result when it already has enough rows', async () => {
    const prisma = fakePrisma([[row('a'), row('b')]])
    const rows = await fetchRandomTrackRows(prisma, 2)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('falls back to BERNOULLI(1) when the first tier comes up short', async () => {
    const prisma = fakePrisma([[row('a')], [row('a'), row('b'), row('c')]])
    const rows = await fetchRandomTrackRows(prisma, 3)
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('falls back all the way to plain ORDER BY random() when both TABLESAMPLE tiers come up short (small library)', async () => {
    const prisma = fakePrisma([[row('a')], [row('a')], [row('a'), row('b')]])
    const rows = await fetchRandomTrackRows(prisma, 2)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3)
  })

  it('returns whatever the final tier has even if still short of count (library smaller than requested count)', async () => {
    const prisma = fakePrisma([[], [], [row('only')]])
    const rows = await fetchRandomTrackRows(prisma, 10)
    expect(rows.map(r => r.id)).toEqual(['only'])
  })
})
