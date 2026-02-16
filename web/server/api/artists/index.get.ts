import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 48))
  const letter = (query.letter as string)?.toLowerCase() || null
  const genre = query.genre as string || null
  const sort = (query.sort as string) || 'name'
  const search = (query.search as string)?.trim() || null
  const minScore = query.minScore ? Number(query.minScore) : null
  const maxScore = query.maxScore ? Number(query.maxScore) : null

  const where: Record<string, unknown> = {}

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
    if (minScore !== null) (where.averageMatchScore as Record<string, number>).gte = minScore / 100
    if (maxScore !== null) (where.averageMatchScore as Record<string, number>).lte = maxScore / 100
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

  const [items, total] = await Promise.all([
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
  ])

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  }
})
