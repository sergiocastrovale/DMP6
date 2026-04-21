import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)

  const favorites = await prisma.favoriteRelease.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      release: {
        include: {
          artists: {
            take: 1,
            select: { artist: { select: { id: true, name: true, slug: true } } },
          },
          type: { select: { name: true } },
          localReleases: {
            select: { id: true, title: true, year: true, image: true, imageUrl: true },
            take: 1,
          },
        },
      },
    },
  })

  return favorites.map((fav) => {
    const local = fav.release.localReleases[0]
    const img = verifyImage(local?.image, local?.imageUrl, 'releases')
    return {
      id: local?.id ?? fav.release.id,
      title: local?.title ?? fav.release.title,
      releaseType: fav.release.type?.name ?? null,
      year: local?.year ?? null,
      image: img.image,
      imageUrl: img.imageUrl,
      artist: fav.release.artists[0]?.artist ?? null,
    }
  })
})
