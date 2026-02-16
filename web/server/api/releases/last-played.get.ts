import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)

  const releases = await prisma.localRelease.findMany({
    where: {
      lastPlayedAt: { not: null },
    },
    take: limit,
    orderBy: { lastPlayedAt: 'desc' },
    include: {
      artist: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      release: {
        select: {
          id: true,
          title: true,
          type: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  })

  return releases.map(release => ({
    id: release.id,
    title: release.title || release.release?.title || 'Unknown Release',
    releaseType: release.release?.type?.name || null,
    year: release.year,
    image: release.image,
    imageUrl: release.imageUrl,
    lastPlayedAt: release.lastPlayedAt,
    playCount: release.totalPlayCount,
    artist: release.artist
      ? {
          id: release.artist.id,
          name: release.artist.name,
          slug: release.artist.slug,
        }
      : null,
    musicBrainzId: release.release?.id || null,
  }))
})
