import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'
import { currentUserId } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=30, stale-while-revalidate=15')
  const userId = currentUserId(event)

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)

  return cachedResponse(`releases:last-played:${userId}:${limit}`, 60, async () => {
    const plays = await prisma.$queryRaw<{ localReleaseId: string, playCount: bigint, lastPlayedAt: Date }[]>`
      SELECT lrt."localReleaseId" AS "localReleaseId",
             SUM(p."playCount")::bigint AS "playCount",
             MAX(p."lastPlayedAt") AS "lastPlayedAt"
      FROM "LocalReleaseTrackPlay" p
      JOIN "LocalReleaseTrack" lrt ON lrt.id = p."trackId"
      WHERE p."userId" = ${userId} AND lrt."localReleaseId" IS NOT NULL
      GROUP BY lrt."localReleaseId"
      ORDER BY MAX(p."lastPlayedAt") DESC
      LIMIT ${limit}
    `
    if (plays.length === 0) {return []}

    const releaseIds = plays.map(p => p.localReleaseId)
    const releases = await prisma.localRelease.findMany({
      where: { id: { in: releaseIds } },
      include: {
        artists: {
          select: { artist: { select: { id: true, name: true, slug: true } } },
        },
        release: {
          select: {
            id: true,
            title: true,
            type: { select: { name: true } },
          },
        },
        tracks: {
          where: { genre: { not: null } },
          select: { genre: true },
          take: 1,
        },
      },
    })
    const byId = new Map(releases.map(r => [r.id, r]))

    return plays.map((p) => {
      const release = byId.get(p.localReleaseId)
      if (!release) {return null}
      return {
        id: release.id,
        title: release.title || release.release?.title || 'Unknown Release',
        releaseType: release.release?.type?.name || null,
        year: release.year,
        ...verifyImage(release.image, release.imageUrl, 'releases'),
        lastPlayedAt: p.lastPlayedAt,
        playCount: Number(p.playCount),
        genre: release.tracks[0]?.genre || null,
        artist: release.artists[0]?.artist ?? null,
        musicBrainzId: release.release?.id || null,
      }
    }).filter((r): r is NonNullable<typeof r> => r !== null)
  })
})
