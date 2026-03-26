import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=60')

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
  const page = Math.max(1, parseInt(query.page as string, 10) || 1)
  const limit = Math.min(parseInt(query.limit as string, 10) || 50, 100)
  const cacheKey = `timeline:${decade}:y=${year ?? ''}:p=${page}:l=${limit}`

  return cachedResponse(cacheKey, 300, async () => {
    const skip = (page - 1) * limit
    const yearStart = year ?? decade
    const yearEnd = year ? year + 1 : decade + 10

    const where = { year: { gte: yearStart, lt: yearEnd } }

    const [releases, total] = await Promise.all([
      prisma.localRelease.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ year: 'asc' }, { title: 'asc' }],
        include: {
          artist: { select: { id: true, name: true, slug: true } },
          release: {
            select: {
              id: true,
              title: true,
              type: { select: { name: true } },
            },
          },
        },
      }),
      prisma.localRelease.count({ where }),
    ])

    let years: { year: number; count: number }[]
    try {
      const rows = await prisma.$queryRaw<{ year: number; release_count: number }[]>`
        SELECT year, release_count FROM dmp_timeline
        WHERE decade = ${decade}
        ORDER BY year ASC
      `
      years = rows.map(r => ({ year: r.year, count: Number(r.release_count) }))
    }
    catch {
      const yearCounts = await prisma.localRelease.groupBy({
        by: ['year'],
        where: { year: { gte: decade, lt: decade + 10 } },
        _count: true,
        orderBy: { year: 'asc' },
      })
      years = yearCounts
        .filter(y => y.year !== null)
        .map(y => ({ year: y.year!, count: y._count }))
    }

    return {
      releases: releases.map(r => ({
        id: r.id,
        title: r.title || r.release?.title || 'Unknown Release',
        releaseType: r.release?.type?.name || null,
        year: r.year,
        image: r.image,
        imageUrl: r.imageUrl,
        artist: r.artist
          ? { id: r.artist.id, name: r.artist.name, slug: r.artist.slug }
          : null,
      })),
      total,
      page,
      hasMore: skip + limit < total,
      years,
    }
  })
})
