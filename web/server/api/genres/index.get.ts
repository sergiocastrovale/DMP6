import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300, stale-while-revalidate=60')

  const query = getQuery(event)
  const search = (query.search as string)?.trim() || null
  // Clamp: FiltersGenre asks for 5 (the mockup's "top 5, then live-narrows"); nothing else calls
  // this with a limit, so an absurd one can't turn into an unbounded scan.
  const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 50)

  const cacheKey = `genres:s=${search ?? ''}:l=${limit}`

  return cachedResponse(cacheKey, 300, async () => {
    const genres = await prisma.genre.findMany({
      where: search ? { name: { contains: search, mode: 'insensitive' } } : undefined,
      select: {
        id: true,
        name: true,
        _count: { select: { artists: true } },
      },
      // Most-common first (the mockup's "start with the 5 most common genres"), name as tiebreak.
      orderBy: [{ artists: { _count: 'desc' } }, { name: 'asc' }],
      take: limit,
    })

    return genres.map(g => ({
      id: g.id,
      name: g.name,
      artistCount: g._count.artists,
    }))
  })
})
