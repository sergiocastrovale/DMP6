import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'
import { parsePagination } from '~/server/utils/pagination'
import { mergeReleaseStats, sortArtistsInMemory } from '~/server/utils/artistReleaseStats'
import { resolveSortDirection } from '~/helpers/browseSort'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=120, stale-while-revalidate=60')

  const query = getQuery(event)
  // maxSize 250 matches browse.ts's "summarized" view pageSize - a lower cap here would silently
  // truncate that view's pages, throwing off its page-size-based skip math (audit #78).
  const { page, pageSize } = parsePagination(query, { defaultSize: 48, maxSize: 250 })
  const letter = (query.letter as string)?.toLowerCase() || null
  const genre = query.genre as string || null
  const sort = (query.sort as string) || 'name'
  // Browse sends this explicitly; a direct API call that omits it falls back to the field's own
  // default (names A-Z, quantities biggest-first).
  const order = resolveSortDirection(sort, query.order)
  const search = (query.search as string)?.trim() || null
  const minScore = query.minScore ? Number(query.minScore) : null
  const maxScore = query.maxScore ? Number(query.maxScore) : null

  const cacheKey = `artists:p=${page}:ps=${pageSize}:l=${letter ?? ''}:g=${genre ?? ''}:s=${sort}:o=${order}:q=${search ?? ''}:min=${minScore ?? ''}:max=${maxScore ?? ''}`

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
        orderBy.totalPlayCount = order
        break
      case 'score':
        orderBy.averageMatchScore = order
        break
      case 'recent':
        orderBy.createdAt = order
        break
      case 'tracks':
        orderBy.totalTracks = order
        break
      case 'releases':
      case 'completeness':
        // No DB column to order by - stays at a stable order, JS-sorted after the release-stats
        // merge below. Kept ascending so the page a user sees is at least deterministic.
        orderBy.slug = 'asc'
        break
      default:
        orderBy.slug = order
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

    const releaseLinks = await prisma.localReleaseArtist.findMany({
      where: { artistId: { in: items.map(a => a.id) } },
      select: { artistId: true, localRelease: { select: { id: true, matchStatus: true } } },
    })

    const verifiedItems = sortArtistsInMemory(
      mergeReleaseStats(items, releaseLinks).map(a => ({
        ...a,
        ...verifyImage(a.image, a.imageUrl, 'artists'),
      })),
      sort,
      order,
    )

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
