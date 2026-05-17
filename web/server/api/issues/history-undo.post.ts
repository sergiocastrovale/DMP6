import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

const MODELS = {
  corrupted: 'issueCorruptedTpe2',
  unsplit: 'issueUnsplitArtist',
  missing: 'issueMissingMetadata',
} as const

type HistoryType = keyof typeof MODELS

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const { ids } = await readBody<{ ids: string[] }>(event)
  if (!Array.isArray(ids) || ids.length === 0) {
    throw createError({ statusCode: 400, message: 'ids must be a non-empty array' })
  }

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
    if (!(type in MODELS)) {
      continue
    }
    const model = MODELS[type as HistoryType]
    const result = await (prisma[model] as any).updateMany({
      where: { id: { in: [...issueIds] }, status: 'RESOLVED' },
      data: { status: 'PENDING_REVERT', updatedAt: new Date() },
    })
    queued[type] = result.count
  }

  return { queued }
})
