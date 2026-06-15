import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { parsePagination } from '~/server/utils/pagination'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const query = getQuery(event)
  const { page, pageSize } = parsePagination(query, { defaultSize: 50, maxSize: 100 })
  const search = (query.search as string)?.trim() || null

  const where: Record<string, unknown> = { relatedOnly: false, primaryArtistId: null }
  if (search) {
    where.name = { contains: search, mode: 'insensitive' }
  }

  const [items, total, monitoredCount] = await Promise.all([
    prisma.artist.findMany({
      where,
      orderBy: { slug: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, slug: true, monitored: true },
    }),
    prisma.artist.count({ where }),
    prisma.artist.count({ where: { relatedOnly: false, primaryArtistId: null, monitored: true } }),
  ])

  return {
    items,
    total,
    monitoredCount,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  }
})
