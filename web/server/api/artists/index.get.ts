import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'
import { parsePagination } from '~/server/utils/pagination'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=120, stale-while-revalidate=60')

  const query = getQuery(event)
  // maxSize 250 matches browse.ts's "summarized" view pageSize - a lower cap here would silently
  // truncate that view's pages, throwing off its page-size-based skip math (audit #78).
  const { page, pageSize } = parsePagination(query, { defaultSize: 48, maxSize: 250 })
  const letter = (query.letter as string)?.toLowerCase() || null
  const genre = query.genre as string || null
  const sort = (query.sort as string) || 'name'
  const search = (query.search as string)?.trim() || null
  const minScore = query.minScore ? Number(query.minScore) : null
  const maxScore = query.maxScore ? Number(query.maxScore) : null

  const cacheKey = `artists:p=${page}:ps=${pageSize}:l=${letter ?? ''}:g=${genre ?? ''}:s=${sort}:q=${search ?? ''}:min=${minScore ?? ''}:max=${maxScore ?? ''}`

  return cachedResponse(cacheKey, 120, async () => {
    // Credit-only artists (MB-verified 'appears on' entries that own no release) have their own page
    // and are searchable, but must not appear in browse. Ownership is derived, never a stored flag.
    const where: Record<string, unknown> = { primaryArtistId: null, localReleases: { some: {} } }

    if (letter) {
      where.slug = { startsWith: letter }
    }

    if (search) {
      where.name = { contains: search, mode: 'insensitive' }
    }

    if (genre) {
      where.genres = { some: { name: genre } }
    }

    if (minScore !== null || maxScore !== null) {
      where.averageMatchScore = {}
      if (minScore !== null) {(where.averageMatchScore as Record<string, number>).gte = minScore / 100}
      if (maxScore !== null) {(where.averageMatchScore as Record<string, number>).lte = maxScore / 100}
    }

    const orderBy: Record<string, string> = {}
    switch (sort) {
      case 'playCount':
        orderBy.totalPlayCount = 'desc'
        break
      case 'score':
        orderBy.averageMatchScore = 'desc'
        break
      case 'recent':
        orderBy.createdAt = 'desc'
        break
      default:
        orderBy.slug = 'asc'
    }

    const [items, total, stats] = await Promise.all([
      prisma.artist.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          image: true,
          imageUrl: true,
          averageMatchScore: true,
          totalPlayCount: true,
          totalTracks: true,
        },
      }),
      prisma.artist.count({ where }),
      prisma.statistics.findUnique({
        where: { id: 'main' },
        select: { mainArtists: true },
      }),
    ])

    const verifiedItems = items.map(a => ({
      ...a,
      ...verifyImage(a.image, a.imageUrl, 'artists'),
    }))

    return {
      items: verifiedItems,
      total,
      mainCount: stats?.mainArtists ?? 0,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    }
  })
})
