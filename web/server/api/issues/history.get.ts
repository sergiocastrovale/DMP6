import { prisma } from '~/server/utils/prisma'
import { parsePagination } from '~/server/utils/pagination'
import { requirePermission } from '~/server/utils/permissions'

const VALID_TYPES = ['corrupted', 'unsplit', 'missing'] as const

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const query = getQuery(event)
  const mode = query.mode as string | undefined
  const type = query.type as string | undefined

  if (mode === 'counts') {
    const [corrupted, unsplit, missing] = await Promise.all([
      prisma.fixHistory.count({ where: { issueType: 'corrupted', revertedAt: null } }),
      prisma.fixHistory.count({ where: { issueType: 'unsplit', revertedAt: null } }),
      prisma.fixHistory.count({ where: { issueType: 'missing', revertedAt: null } }),
    ])
    return { counts: { corrupted, unsplit, missing }, total: corrupted + unsplit + missing }
  }

  if (type && VALID_TYPES.includes(type as any)) {
    const { page: p, pageSize: ps, skip } = parsePagination(query, { defaultSize: 50, maxSize: 100 })
    const where = { issueType: type, revertedAt: null }

    const [items, total] = await Promise.all([
      prisma.fixHistory.findMany({
        where,
        skip,
        take: ps,
        orderBy: { appliedAt: 'desc' },
      }),
      prisma.fixHistory.count({ where }),
    ])

    return { items, total, page: p, pageSize: ps, hasMore: skip + ps < total }
  }

  const count = await prisma.fixHistory.count({ where: { revertedAt: null } })
  return { count }
})
