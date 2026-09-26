import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { RELEASE_TILE_SELECT, toReleaseTile } from '~/server/utils/releaseTiles'
import { shuffleArray } from '~/helpers/playerLogic'
import { currentUserId } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300, stale-while-revalidate=60')
  const userId = currentUserId(event)

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 8, 50)

  // Cache the underlying 50-candidate pool only - shuffling happens on every request, below, so
  // "random" doesn't mean "the same 8 for 5 minutes" (audit #86).
  const releases = await cachedResponse(`releases:archive:pool:${userId}`, 300, async () => {
    const twoYearsAgo = new Date()
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)

    // Per-user "archived": either this user's last play on it is over 2 years old, or they've
    // never played it and it was added over 2 years ago.
    const lastPlays = await prisma.$queryRaw<{ localReleaseId: string, lastPlayedAt: Date }[]>`
      SELECT lrt."localReleaseId" AS "localReleaseId", MAX(p."lastPlayedAt") AS "lastPlayedAt"
      FROM "LocalReleaseTrackPlay" p
      JOIN "LocalReleaseTrack" lrt ON lrt.id = p."trackId"
      WHERE p."userId" = ${userId} AND lrt."localReleaseId" IS NOT NULL
      GROUP BY lrt."localReleaseId"
    `
    const staleReleaseIds = lastPlays.filter(p => p.lastPlayedAt < twoYearsAgo).map(p => p.localReleaseId)
    const playedReleaseIds = lastPlays.map(p => p.localReleaseId)

    return prisma.localRelease.findMany({
      where: {
        OR: [
          { id: { in: staleReleaseIds } },
          { id: { notIn: playedReleaseIds }, createdAt: { lt: twoYearsAgo } },
        ],
      },
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: RELEASE_TILE_SELECT,
    })
  })

  const shuffled = shuffleArray([...releases]).slice(0, limit)

  return shuffled.map(toReleaseTile)
})
