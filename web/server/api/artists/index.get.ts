import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'
import { parsePagination } from '~/server/utils/pagination'
import { withReleaseCounts } from '~/server/utils/artistReleaseStats'
import { artistListWhere, rankedArtistPage, releaseCountsByArtist, type ArtistListFilters } from '~/server/utils/artistList'
import { resolveSortDirection } from '~/helpers/browseSort'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { artistPlayTotals } from '~/server/utils/userPlays'

const selectFields = {
  id: true,
  name: true,
  slug: true,
  image: true,
  imageUrl: true,
  completeness: true,
  totalTracks: true,
  musicbrainzId: true,
} as const

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=120, stale-while-revalidate=60')
  const userId = currentUserId(event)

  const query = getQuery(event)
  // maxSize 250 matches browse.ts's "summarized" view pageSize - a lower cap here would silently
  // truncate that view's pages, throwing off its page-size-based skip math (audit #78).
  const { page, pageSize } = parsePagination(query, { defaultSize: 48, maxSize: 250 })
  const sort = (query.sort as string) || 'name'
  // Browse sends this explicitly; a direct API call that omits it falls back to the field's own
  // default (names A-Z, quantities biggest-first).
  const order = resolveSortDirection(sort, query.order)
  const genres = (Array.isArray(query.genre) ? query.genre : query.genre ? [query.genre] : []) as string[]
  const minCompleteness = query.minCompleteness ? Number(query.minCompleteness) : null
  const maxCompleteness = query.maxCompleteness ? Number(query.maxCompleteness) : null

  const filters: ArtistListFilters = {
    letter: (query.letter as string)?.toLowerCase() || null,
    search: (query.search as string)?.trim() || null,
    genres,
    minCompleteness: minCompleteness !== null ? minCompleteness / 100 : null,
    maxCompleteness: maxCompleteness !== null ? maxCompleteness / 100 : null,
  }
  const where = artistListWhere(filters)

  // `releases` and `playCount` have no column to order by - the first is a count over a many-to-many join,
  // the second is per-user (LocalReleaseTrackPlay, server/utils/userPlays.ts). The database ranks them
  // (artistList.ts) and hands back one page of ids; only that page's rows are then loaded. Not cached: the
  // play-count order is per user, and the release-count query is cheap.
  if (sort === 'releases' || sort === 'playCount') {
    const [ranked, stats] = await Promise.all([
      rankedArtistPage(filters, sort, order, userId, (page - 1) * pageSize, pageSize),
      prisma.statistics.findUnique({ where: { id: 'main' }, select: { mainArtists: true } }),
    ])

    const [rows, counts, playTotals] = await Promise.all([
      prisma.artist.findMany({ where: { id: { in: ranked.ids } }, select: selectFields }),
      releaseCountsByArtist(ranked.ids),
      artistPlayTotals(userId, ranked.ids),
    ])
    const byId = new Map(rows.map(r => [r.id, r]))
    const ordered = ranked.ids.flatMap(id => byId.get(id) ?? [])

    const items = withReleaseCounts(ordered, counts).map(a => ({
      ...a,
      ...verifyImage(a.image, a.imageUrl, 'artists'),
      totalPlayCount: playTotals.get(a.id) ?? 0,
    }))

    return {
      items,
      total: ranked.total,
      mainCount: stats?.mainArtists ?? 0,
      page,
      pageSize,
      hasMore: page * pageSize < ranked.total,
    }
  }

  // Sorted so two requests with the same genres in a different order share one cache entry.
  const genreKey = [...genres].sort().join(',')
  const cacheKey = `artists:p=${page}:ps=${pageSize}:l=${filters.letter ?? ''}:g=${genreKey}:s=${sort}:o=${order}:q=${filters.search ?? ''}:min=${minCompleteness ?? ''}:max=${maxCompleteness ?? ''}`

  const cached = await cachedResponse(cacheKey, 120, async () => {
    const orderBy: Record<string, unknown> = {}
    switch (sort) {
      case 'completeness':
        // Null completeness (no album/EP catalogue, never MB-matched) must sink to the bottom
        // regardless of direction - Postgres' default is NULLS LAST only for ASC, NULLS FIRST for
        // DESC, which would put unmatched artists above every real value on the default (desc) sort.
        orderBy.completeness = { sort: order, nulls: 'last' }
        break
      case 'recent':
        orderBy.createdAt = order
        break
      case 'updated':
        orderBy.updatedAt = order
        break
      case 'tracks':
        orderBy.totalTracks = order
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
        select: selectFields,
      }),
      prisma.artist.count({ where }),
      prisma.statistics.findUnique({
        where: { id: 'main' },
        select: { mainArtists: true },
      }),
    ])

    const counts = await releaseCountsByArtist(items.map(a => a.id))
    const verifiedItems = withReleaseCounts(items, counts).map(a => ({
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
  }, { shared: true })

  // Per-user, so attached after the shared cache rather than baked into it (its Redis entry is
  // process-wide, not per caller) - same pattern as app-stats.get.ts's playlist/favorite counts.
  const playTotals = await artistPlayTotals(userId, cached.items.map((a: { id: string }) => a.id))
  return {
    ...cached,
    items: cached.items.map((a: { id: string }) => ({ ...a, totalPlayCount: playTotals.get(a.id) ?? 0 })),
  }
})
