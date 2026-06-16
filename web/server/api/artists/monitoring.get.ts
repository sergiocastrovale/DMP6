import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { parsePagination } from '~/server/utils/pagination'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const query = getQuery(event)
  const { page, pageSize } = parsePagination(query, { defaultSize: 50, maxSize: 100 })
  const search = (query.search as string)?.trim() || null
  const showMonitored = query.showMonitored !== 'false'
  const showComplete = query.showComplete === 'true'

  const conditions = [Prisma.sql`a."relatedOnly" = false`, Prisma.sql`a."primaryArtistId" IS NULL`]
  if (search) {
    conditions.push(Prisma.sql`a.name ILIKE ${`%${search}%`}`)
  }
  if (!showMonitored) {
    conditions.push(Prisma.sql`a.monitored = false`)
  }
  if (!showComplete) {
    conditions.push(Prisma.sql`NOT (COALESCE(c.total, 0) > 0 AND COALESCE(c.missing, 0) = 0)`)
  }
  const whereClause = Prisma.join(conditions, ' AND ')

  const monitoredCount = await prisma.artist.count({ where: { relatedOnly: false, primaryArtistId: null, monitored: true } })

  const rows = await prisma.$queryRaw<Array<{
    id: string
    name: string
    slug: string
    monitored: boolean
    totalReleases: bigint
    missingReleases: bigint
    fullCount: bigint
  }>>`
    WITH counts AS (
      SELECT mra."artistId",
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE mr.status = 'MISSING') AS missing
      FROM "MusicBrainzReleaseArtist" mra
      JOIN "MusicBrainzRelease" mr ON mr.id = mra."releaseId"
      GROUP BY mra."artistId"
    )
    SELECT a.id, a.name, a.slug, a.monitored,
      COALESCE(c.total, 0) AS "totalReleases",
      COALESCE(c.missing, 0) AS "missingReleases",
      COUNT(*) OVER() AS "fullCount"
    FROM "Artist" a
    LEFT JOIN counts c ON c."artistId" = a.id
    WHERE ${whereClause}
    ORDER BY a.slug ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `

  const total = rows.length ? Number(rows[0]!.fullCount) : 0

  return {
    items: rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      monitored: r.monitored,
      totalReleases: Number(r.totalReleases),
      missingReleases: Number(r.missingReleases),
    })),
    total,
    monitoredCount,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  }
})
