import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { fetchRandomTrackRows } from '../../../server/utils/randomBatch'
import { _resetSampleCacheForTest } from '../../../server/utils/randomSample'

const row = (id: string) => ({ id, title: 't', artist: 'a', album: 'al', duration: 100, localReleaseId: null })

// sampleIds asks for reltuples, then the sampled ids (possibly escalating), then fetchRandomTrackRows loads the rows.
const fakePrisma = (results: unknown[][]): PrismaClient => {
  const queryRaw = vi.fn()
  for (const r of results) {queryRaw.mockImplementationOnce(() => Promise.resolve(r))}
  return { $queryRaw: queryRaw } as unknown as PrismaClient
}

describe('fetchRandomTrackRows', () => {
  beforeEach(() => _resetSampleCacheForTest())

  it('returns the sampled rows in sampled (shuffled) order', async () => {
    const prisma = fakePrisma([[{ rows: 2_000_000 }], [{ id: 'b' }, { id: 'a' }], [row('a'), row('b')]])
    const rows = await fetchRandomTrackRows(prisma, 2)
    expect(rows.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('returns nothing without a second query when the sample is empty', async () => {
    const prisma = fakePrisma([[{ rows: 0 }], []])
    expect(await fetchRandomTrackRows(prisma, 5)).toEqual([])
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('drops ids whose row vanished between the sample and the load', async () => {
    const prisma = fakePrisma([[{ rows: 2_000_000 }], [{ id: 'a' }, { id: 'gone' }], [row('a')]])
    const rows = await fetchRandomTrackRows(prisma, 2)
    expect(rows.map(r => r.id)).toEqual(['a'])
  })
})
