import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { parsePagination } from '~/server/utils/pagination'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const query = getQuery(event)
  const country = query.country as string
  if (!country) {
    throw createError({ statusCode: 400, message: 'country required' })
  }

  const { page, pageSize } = parsePagination(query, { defaultSize: 50, maxSize: 100 })

  const where = {
    country,
    primaryArtistId: null,
    localReleases: { some: {} },
  }

  const [items, total] = await Promise.all([
    prisma.artist.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        imageUrl: true,
        totalTracks: true,
      },
    }),
    prisma.artist.count({ where }),
  ])

  return {
    items: items.map((a) => ({
      ...a,
      ...verifyImage(a.image, a.imageUrl, 'artists'),
    })),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  }
})
