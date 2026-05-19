import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.view')

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
        },
      },
    },
  })

  return favorites.map((fav) => {
    const img = verifyImage(fav.release.image, fav.release.imageUrl, 'releases')
    return {
      id: fav.release.id,
      title: fav.release.title,
      year: fav.release.year,
      image: img.image,
      imageUrl: img.imageUrl,
      artist: fav.release.artists[0]?.artist ?? null,
    }
  })
})
