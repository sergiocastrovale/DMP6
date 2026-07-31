import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'
import { shuffleArray } from '~/helpers/playerLogic'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300, stale-while-revalidate=60')

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 8, 50)

  // Cache the underlying 50-candidate pool only - shuffling happens on every request, below, so
  // "random" doesn't mean "the same 8 for 5 minutes" (audit #86).
  const releases = await cachedResponse('releases:archive:pool', 300, async () => {
    const twoYearsAgo = new Date()
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)

    return prisma.localRelease.findMany({
      where: {
        OR: [
          { lastPlayedAt: { lt: twoYearsAgo } },
          { lastPlayedAt: null, createdAt: { lt: twoYearsAgo } },
        ],
      },
      take: 50,
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
  })

  const shuffled = shuffleArray([...releases]).slice(0, limit)

  return shuffled.map(release => ({
    id: release.id,
    title: release.title || release.release?.title || 'Unknown Release',
    releaseType: release.release?.type?.name || null,
    year: release.year,
    ...verifyImage(release.image, release.imageUrl, 'releases'),
    genre: release.tracks[0]?.genre || null,
    artist: release.artists[0]?.artist ?? null,
    musicBrainzId: release.release?.id || null,
  }))
})
