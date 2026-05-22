import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=30')

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)

  return cachedResponse(`releases:latest:${limit}`, 120, async () => {
    const releases = await prisma.localRelease.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
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

    return releases.map(release => ({
      id: release.id,
      title: release.title || release.release?.title || 'Unknown Release',
      releaseType: release.release?.type?.name || null,
      year: release.year,
      ...verifyImage(release.image, release.imageUrl, 'releases'),
      createdAt: release.createdAt,
      genre: release.tracks[0]?.genre || null,
      artist: release.artists[0]?.artist ?? null,
      musicBrainzId: release.release?.id || null,
    }))
  })
})
