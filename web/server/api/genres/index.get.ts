import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=60')

  return cachedResponse('genres', 300, async () => {
    const genres = await prisma.genre.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { artists: true } },
      },
      orderBy: { name: 'asc' },
    })

    return genres.map(g => ({
      id: g.id,
      name: g.name,
      artistCount: g._count.artists,
    }))
  })
})
