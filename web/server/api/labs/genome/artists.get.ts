
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const genreId = query.genreId as string
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Number(query.pageSize) || 50)

  if (!genreId) {
    throw createError({ statusCode: 400, message: 'genreId required' })
  }

  const [items, total] = await Promise.all([
    prisma.artist.findMany({
      where: { genres: { some: { id: genreId } }, relatedOnly: false },
      select: { id: true, name: true, slug: true, image: true, imageUrl: true },
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.artist.count({
      where: { genres: { some: { id: genreId } }, relatedOnly: false },
    }),
  ])

  return {
    items,
    total,
    hasMore: page * pageSize < total,
  }
})
