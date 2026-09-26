import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { idsBodySchema } from '~/server/schemas/common'
import { findIssueType } from '~/server/utils/issueTypes'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.fix')

  const { ids } = await readBodyOf(event, idsBodySchema)

  const rows = await prisma.fixHistory.findMany({
    where: { id: { in: ids }, revertedAt: null },
    select: { issueId: true, issueType: true },
  })

  const byType = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = byType.get(row.issueType) || new Set()
    set.add(row.issueId)
    byType.set(row.issueType, set)
  }

  const queued: Record<string, number> = {}

  for (const [type, issueIds] of byType) {
    const def = findIssueType(type)
    if (!def?.revertable) {
      continue
    }
    const result = await def.delegate.updateMany({
      where: { id: { in: [...issueIds] }, status: 'RESOLVED' },
      data: { status: 'PENDING_REVERT', updatedAt: new Date() },
    })
    queued[type] = result.count
  }

  return { queued }
})
