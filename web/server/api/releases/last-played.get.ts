import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=30, stale-while-revalidate=15')

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)

  return cachedResponse(`releases:last-played:${limit}`, 60, async () => {
    const releases = await prisma.localRelease.findMany({
      where: { lastPlayedAt: { not: null } },
      take: limit,
      orderBy: { lastPlayedAt: 'desc' },
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
      },
    })

    return releases.map(release => ({
      id: release.id,
      title: release.title || release.release?.title || 'Unknown Release',
      releaseType: release.release?.type?.name || null,
      year: release.year,
      ...verifyImage(release.image, release.imageUrl, 'releases'),
      lastPlayedAt: release.lastPlayedAt,
      playCount: release.totalPlayCount,
      artist: release.artists[0]?.artist ?? null,
      musicBrainzId: release.release?.id || null,
    }))
  })
})
