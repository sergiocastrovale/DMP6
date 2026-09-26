import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'
import { parsePagination } from '~/server/utils/pagination'
import { mergeReleaseStats, sortArtistsInMemory } from '~/server/utils/artistReleaseStats'
import { resolveSortDirection } from '~/helpers/browseSort'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { artistPlayTotals } from '~/server/utils/userPlays'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=120, stale-while-revalidate=60')
  const userId = currentUserId(event)

  const query = getQuery(event)
  // maxSize 250 matches browse.ts's "summarized" view pageSize - a lower cap here would silently
  // truncate that view's pages, throwing off its page-size-based skip math (audit #78).
  const { page, pageSize } = parsePagination(query, { defaultSize: 48, maxSize: 250 })
  const letter = (query.letter as string)?.toLowerCase() || null
  const sort = (query.sort as string) || 'name'
  // Browse sends this explicitly; a direct API call that omits it falls back to the field's own
  // default (names A-Z, quantities biggest-first).
  const order = resolveSortDirection(sort, query.order)
  const search = (query.search as string)?.trim() || null
  // OR semantics - an artist matches if tagged with any of the checked genres.
  const genres = (Array.isArray(query.genre) ? query.genre : query.genre ? [query.genre] : []) as string[]
  const minCompleteness = query.minCompleteness ? Number(query.minCompleteness) : null
  const maxCompleteness = query.maxCompleteness ? Number(query.maxCompleteness) : null

  // Credit-only artists (MB-verified 'appears on' entries that own no release) have their own page
  // and are searchable, but must not appear in browse. Ownership is normally derived, never a
  // stored flag - except `manuallyAdded` (./add, CLAUDE.md Data Model), which lets an artist added
  // before owning any files still show up here.
  const where: Record<string, unknown> = {
    primaryArtistId: null,
    OR: [{ localReleases: { some: {} } }, { manuallyAdded: true }],
  }

  if (letter) {
    where.slug = { startsWith: letter }
  }

  if (search) {
    where.name = { contains: search, mode: 'insensitive' }
  }

  if (genres.length) {
    where.genres = { some: { name: { in: genres } } }
  }

  if (minCompleteness !== null || maxCompleteness !== null) {
    where.completeness = {}
    if (minCompleteness !== null) {(where.completeness as Record<string, number>).gte = minCompleteness / 100}
    if (maxCompleteness !== null) {(where.completeness as Record<string, number>).lte = maxCompleteness / 100}
  }

  const selectFields = {
    id: true,
    name: true,
    slug: true,
    image: true,
    imageUrl: true,
    completeness: true,
    totalTracks: true,
    musicbrainzId: true,
  }

  // `releases`/`playCount` have no DB column to order by - `releases` only exists after merging the
  // release-stats join below, and `playCount` is per-user (LocalReleaseTrackPlay, server/utils/
  // userPlays.ts), so both, and their page, are computed per request rather than through the shared
  // cache below. Paginating the DB query first and JS-sorting just that page (the old approach for
  // `releases`) only ever reordered whichever 48 artists a *different* column put on this page - the
  // artist with the most releases could be sitting on page 6 and never surface. This sort must load
  // every artist matching `where`, sort by the merged stat, then slice the page in JS.
  if (sort === 'releases' || sort === 'playCount') {
    const [allItems, stats] = await Promise.all([
      prisma.artist.findMany({ where, orderBy: { slug: 'asc' }, select: selectFields }),
      prisma.statistics.findUnique({ where: { id: 'main' }, select: { mainArtists: true } }),
    ])

    const [releaseLinks, playTotals] = await Promise.all([
      prisma.localReleaseArtist.findMany({
        where: { artistId: { in: allItems.map(a => a.id) } },
        select: { artistId: true, localRelease: { select: { id: true } } },
      }),
      artistPlayTotals(userId, allItems.map(a => a.id)),
    ])

    const withStats = mergeReleaseStats(allItems, releaseLinks).map(a => ({
      ...a,
      totalPlayCount: playTotals.get(a.id) ?? 0,
    }))
    const sorted = sortArtistsInMemory(withStats, sort, order)
    const total = sorted.length
    const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize)
      .map(a => ({ ...a, ...verifyImage(a.image, a.imageUrl, 'artists') }))

    return {
      items: pageItems,
      total,
      mainCount: stats?.mainArtists ?? 0,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    }
  }

  // Sorted so two requests with the same genres in a different order share one cache entry.
  const genreKey = [...genres].sort().join(',')
  const cacheKey = `artists:p=${page}:ps=${pageSize}:l=${letter ?? ''}:g=${genreKey}:s=${sort}:o=${order}:q=${search ?? ''}:min=${minCompleteness ?? ''}:max=${maxCompleteness ?? ''}`

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

    const releaseLinks = await prisma.localReleaseArtist.findMany({
      where: { artistId: { in: items.map(a => a.id) } },
      select: { artistId: true, localRelease: { select: { id: true } } },
    })

    const verifiedItems = mergeReleaseStats(items, releaseLinks).map(a => ({
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
