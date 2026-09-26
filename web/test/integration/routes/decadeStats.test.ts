import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeArtist, makeLocalRelease, makeLocalTrack, makeUser } from '../../factories'
import { decadeAggregates, decadePlayTotals, withPlayTotals } from '../../../server/utils/decadeStats'

const prisma = getTestPrisma()

describe('Decade DNA stats (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const seed = async () => {
    const a = await makeArtist(prisma, { name: 'A', slug: 'a' })
    const b = await makeArtist(prisma, { name: 'B', slug: 'b' })
    const r90 = await makeLocalRelease(prisma, { year: 1994 })
    const r00 = await makeLocalRelease(prisma, { year: 2003 })
    await makeLocalRelease(prisma, { year: null }) // ignored
    // r90 is co-owned by two artists - the case that used to double-count plays.
    await prisma.localReleaseArtist.createMany({ data: [
      { localReleaseId: r90.id, artistId: a.id },
      { localReleaseId: r90.id, artistId: b.id },
      { localReleaseId: r00.id, artistId: a.id },
    ] })
    const t1 = await makeLocalTrack(prisma, { localReleaseId: r90.id, duration: 200, bitrate: 320, genre: 'Rock; Pop' })
    const t2 = await makeLocalTrack(prisma, { localReleaseId: r90.id, duration: 100, bitrate: 128, genre: 'rock' })
    const t3 = await makeLocalTrack(prisma, { localReleaseId: r00.id, duration: 300, bitrate: 256, genre: 'Jazz' })
    return { a, b, r90, r00, t1, t2, t3 }
  }

  it('aggregates releases, tracks, artists, averages and top genres per decade', async () => {
    await seed()

    const stats = await decadeAggregates(prisma)

    expect(stats.map(s => s.decade)).toEqual(['1990s', '2000s'])
    expect(stats[0]).toMatchObject({ releaseCount: 1, trackCount: 2, artistCount: 2, avgDuration: 150, avgBitrate: 224 })
    expect(stats[0]!.topGenres).toEqual([{ name: 'rock', count: 2 }, { name: 'pop', count: 1 }])
    expect(stats[1]).toMatchObject({ releaseCount: 1, trackCount: 1, artistCount: 1, avgDuration: 300 })
  })

  it('counts each play once per user - a co-owned release does not double them', async () => {
    const { t1, t2, t3 } = await seed()
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    await prisma.localReleaseTrackPlay.createMany({ data: [
      { userId: alice.id, trackId: t1.id, playCount: 3, lastPlayedAt: new Date() },
      { userId: alice.id, trackId: t2.id, playCount: 2, lastPlayedAt: new Date() },
      { userId: alice.id, trackId: t3.id, playCount: 4, lastPlayedAt: new Date() },
      { userId: bob.id, trackId: t1.id, playCount: 50, lastPlayedAt: new Date() },
    ] })

    const alicePlays = await decadePlayTotals(prisma, alice.id)

    expect(Object.fromEntries(alicePlays)).toEqual({ '1990s': 5, '2000s': 4 })
    const merged = withPlayTotals(await decadeAggregates(prisma), alicePlays)
    expect(merged.map(m => m.totalPlayCount)).toEqual([5, 4])
    expect((await decadePlayTotals(prisma, (await makeUser(prisma)).id)).size).toBe(0)
  })
})
