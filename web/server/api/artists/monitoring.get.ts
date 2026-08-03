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
  const showUnmonitored = query.showUnmonitored !== 'false'

  const conditions = [
    Prisma.sql`a."primaryArtistId" IS NULL`,
    Prisma.sql`EXISTS (SELECT 1 FROM "LocalReleaseArtist" l WHERE l."artistId" = a.id)`,
  ]
  if (search) {
    conditions.push(Prisma.sql`a.name ILIKE ${`%${search}%`}`)
  }
  // Two independent toggles over the full list: monitored-only, unmonitored-only, both, or neither (empty).
  if (showMonitored && !showUnmonitored) {
    conditions.push(Prisma.sql`a.monitored = true`)
  }
  else if (!showMonitored && showUnmonitored) {
    conditions.push(Prisma.sql`a.monitored = false`)
  }
  else if (!showMonitored && !showUnmonitored) {
    conditions.push(Prisma.sql`false`)
  }
  const whereClause = Prisma.join(conditions, ' AND ')

  const sortColumns: Record<string, Prisma.Sql> = {
    name: Prisma.sql`a.slug`,
    missingReleases: Prisma.sql`COALESCE(c.missing, 0)`,
    totalReleases: Prisma.sql`COALESCE(c.total, 0)`,
    monitored: Prisma.sql`a.monitored`,
  }
  const sortKey = typeof query.sort === 'string' && query.sort in sortColumns ? query.sort : 'name'
  const orderCol = sortColumns[sortKey]!
  const orderDir = query.dir === 'desc' ? Prisma.raw('DESC') : Prisma.raw('ASC')

  const monitoredCount = await prisma.artist.count({ where: { primaryArtistId: null, monitored: true, localReleases: { some: {} } } })

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
    ORDER BY ${orderCol} ${orderDir}, a.slug ASC
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
