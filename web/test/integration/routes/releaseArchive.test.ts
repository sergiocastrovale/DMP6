import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeLocalRelease, makeLocalTrack, makeUser } from '../../factories'
import { archiveCutoff, randomArchivedReleaseIds } from '../../../server/utils/releaseArchive'
import { _resetSampleCacheForTest } from '../../../server/utils/randomSample'

const prisma = getTestPrisma()
const NOW = new Date('2026-09-26T12:00:00Z')
const yearsAgo = (n: number) => new Date(NOW.getFullYear() - n, NOW.getMonth(), NOW.getDate())

describe('archived releases (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    _resetSampleCacheForTest()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const play = async (userId: number, releaseId: string, lastPlayedAt: Date) => {
    const track = await makeLocalTrack(prisma, { localReleaseId: releaseId })
    await prisma.localReleaseTrackPlay.create({ data: { userId, trackId: track.id, playCount: 1, lastPlayedAt } })
  }

  it('offers releases last played over two years ago, or never played and added over two years ago', async () => {
    const user = await makeUser(prisma)
    const stalePlay = await makeLocalRelease(prisma, { createdAt: new Date() })          // recently added, but last played 3y ago
    const neverOld = await makeLocalRelease(prisma, { createdAt: yearsAgo(3) })          // never played, old
    const neverNew = await makeLocalRelease(prisma, { createdAt: yearsAgo(0) })          // never played, recent
    const recentPlay = await makeLocalRelease(prisma, { createdAt: yearsAgo(5) })        // played last month
    await play(user.id, stalePlay.id, yearsAgo(3))
    await play(user.id, recentPlay.id, new Date(NOW.getTime() - 30 * 86400000))

    const ids = await randomArchivedReleaseIds(prisma, user.id, 50, NOW)

    expect(new Set(ids)).toEqual(new Set([stalePlay.id, neverOld.id]))
    expect(ids).not.toContain(neverNew.id)
    expect(ids).not.toContain(recentPlay.id)
  })

  it('is per user: someone else\'s recent play does not hide a release from you', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const release = await makeLocalRelease(prisma, { createdAt: yearsAgo(4) })
    await play(bob.id, release.id, new Date(NOW.getTime() - 86400000))

    expect(await randomArchivedReleaseIds(prisma, alice.id, 10, NOW)).toEqual([release.id])
    expect(await randomArchivedReleaseIds(prisma, bob.id, 10, NOW)).toEqual([])
  })

  it('handles a listening history far beyond the bind-parameter limit without passing ids back', async () => {
    const user = await makeUser(prisma)
    // 40k played releases (over 32,767) - the old NOT IN (...) list would have blown the limit.
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalRelease" (id, title, "groupKey", "createdAt", "updatedAt")
      SELECT 'big-' || g, 'R' || g, 'big-' || g, now() - interval '5 years', now() FROM generate_series(1, 40000) g`)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalReleaseTrack" (id, title, "filePath", "localReleaseId", "updatedAt")
      SELECT 't-' || g, 'T' || g, '/m/t-' || g || '.mp3', 'big-' || g, now() FROM generate_series(1, 40000) g`)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalReleaseTrackPlay" (id, "userId", "trackId", "playCount", "lastPlayedAt", "updatedAt")
      SELECT 'p-' || g, ${user.id}, 't-' || g, 1, now() - interval '10 days', now() FROM generate_series(1, 40000) g`)
    const unplayed = await makeLocalRelease(prisma, { createdAt: yearsAgo(6) })
    await prisma.$executeRawUnsafe('ANALYZE')

    const ids = await randomArchivedReleaseIds(prisma, user.id, 5, new Date())

    expect(ids).toEqual([unplayed.id])
  })

  it('cutoff is exactly two years back', () => {
    expect(archiveCutoff(NOW).getFullYear()).toBe(NOW.getFullYear() - 2)
  })
})
