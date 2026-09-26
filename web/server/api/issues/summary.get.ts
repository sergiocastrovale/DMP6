import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { countByStatus } from '~/server/utils/issueTypes'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const [lastAudit, counts] = await Promise.all([
    prisma.auditRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    countByStatus('DETECTED'),
  ])

  return { lastAudit, counts }
})
