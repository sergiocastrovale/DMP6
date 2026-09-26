import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { paged, parsePagination } from '~/server/utils/pagination'
import { RELEASE_TILE_SELECT_NO_GENRE, toReleaseTile } from '~/server/utils/releaseTiles'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300, stale-while-revalidate=60')

  const decadeParam = getRouterParam(event, 'decade')
  const query = getQuery(event)

  if (!decadeParam) {
    throw createError({ statusCode: 400, statusMessage: 'Missing decade' })
  }

  const decade = parseInt(decadeParam, 10)
  if (isNaN(decade)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid decade' })
  }

  const year = query.year ? parseInt(query.year as string, 10) : null
  const { page, pageSize, skip } = parsePagination(query, { defaultSize: 50, maxSize: 100 })
  const cacheKey = `timeline:${decade}:y=${year ?? ''}:p=${page}:l=${pageSize}`

  return cachedResponse(cacheKey, 300, async () => {
    const yearStart = year ?? decade
    const yearEnd = year ? year + 1 : decade + 10

    const where = { year: { gte: yearStart, lt: yearEnd } }

    const [releases, total] = await Promise.all([
      prisma.localRelease.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ year: 'asc' }, { title: 'asc' }],
        select: RELEASE_TILE_SELECT_NO_GENRE,
      }),
      prisma.localRelease.count({ where }),
    ])

    const yearCounts = await prisma.localRelease.groupBy({
      by: ['year'],
      where: { year: { gte: decade, lt: decade + 10 } },
      _count: true,
      orderBy: { year: 'asc' },
    })
    const years = yearCounts
      .filter(y => y.year !== null)
      .map(y => ({ year: y.year!, count: y._count }))

    const { items, ...rest } = paged(releases.map((r) => {
      const { genre: _genre, musicBrainzId: _mb, ...tile } = toReleaseTile(r)
      return tile
    }), total, { page, pageSize, skip })
    return { releases: items, ...rest, years }
  }, { shared: true })
})
