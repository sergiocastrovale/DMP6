import { Prisma } from '@prisma/client'
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

  const ids = items.map(i => i.id)
  const releaseCounts = ids.length
    ? await prisma.$queryRaw<Array<{ artistId: string; total: bigint; missing: bigint }>>`
        SELECT mra."artistId",
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE mr.status = 'MISSING') AS missing
        FROM "MusicBrainzReleaseArtist" mra
        JOIN "MusicBrainzRelease" mr ON mr.id = mra."releaseId"
        WHERE mra."artistId" IN (${Prisma.join(ids)})
        GROUP BY mra."artistId"
      `
    : []

  const countsById = new Map(releaseCounts.map(r => [r.artistId, { total: Number(r.total), missing: Number(r.missing) }]))

  return {
    items: items.map(i => ({
      ...i,
      totalReleases: countsById.get(i.id)?.total ?? 0,
      missingReleases: countsById.get(i.id)?.missing ?? 0,
    })),
    total,
    monitoredCount,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  }
})
