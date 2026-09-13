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
  const minCompleteness = query.minCompleteness ? Number(query.minCompleteness) : null
  const maxCompleteness = query.maxCompleteness ? Number(query.maxCompleteness) : null

  const cacheKey = `artists:p=${page}:ps=${pageSize}:l=${letter ?? ''}:g=${genre ?? ''}:s=${sort}:o=${order}:q=${search ?? ''}:min=${minCompleteness ?? ''}:max=${maxCompleteness ?? ''}`

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
      totalPlayCount: true,
      totalTracks: true,
    }

    // `releases` has no DB column to order by - the count only exists after merging the
    // release-stats join below. Paginating the DB query first and JS-sorting just that page (the
    // old approach) only ever reordered whichever 48 artists a *different* column put on this
    // page - the artist with the most releases could be sitting on page 6 and never surface. This
    // sort must load every artist matching `where`, sort by the merged stat, then slice the page
    // in JS.
    if (sort === 'releases') {
      const [allItems, stats] = await Promise.all([
        prisma.artist.findMany({ where, orderBy: { slug: 'asc' }, select: selectFields }),
        prisma.statistics.findUnique({ where: { id: 'main' }, select: { mainArtists: true } }),
      ])

      const releaseLinks = await prisma.localReleaseArtist.findMany({
        where: { artistId: { in: allItems.map(a => a.id) } },
        select: { artistId: true, localRelease: { select: { id: true } } },
      })

      const sorted = sortArtistsInMemory(mergeReleaseStats(allItems, releaseLinks), sort, order)
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

    const orderBy: Record<string, unknown> = {}
    switch (sort) {
      case 'playCount':
        orderBy.totalPlayCount = order
        break
      case 'completeness':
        // Null completeness (no album/EP catalogue, never MB-matched) must sink to the bottom
        // regardless of direction - Postgres' default is NULLS LAST only for ASC, NULLS FIRST for
        // DESC, which would put unmatched artists above every real value on the default (desc) sort.
        orderBy.completeness = { sort: order, nulls: 'last' }
        break
      case 'recent':
        orderBy.createdAt = order
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
  })
})
