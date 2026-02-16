import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  const genres = await prisma.genre.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { artists: true } },
    },
    orderBy: { name: 'asc' },
  })

  return genres.map(g => ({
    id: g.id,
    name: g.name,
    artistCount: g._count.artists,
  }))
})
