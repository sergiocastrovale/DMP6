import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

// Recent background monitor-loop issues (warn/error), newest first, for the MonitoringTab "Recent
// issues" panel. Notices are never persisted, so this is issues-only by construction.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const query = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50))

  const items = await prisma.monitorEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, level: true, message: true, createdAt: true },
  })

  return { items }
})
