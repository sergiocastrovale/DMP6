import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import type { HistoryIssueType as RevertableType } from '~/types/issues'

const REVERTABLE_MODELS = {
  corrupted: 'issueCorruptedTpe2',
  missing: 'issueMissingMetadata',
} as const satisfies Record<RevertableType, string>

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const type = getRouterParam(event, 'type') as RevertableType
  if (!(type in REVERTABLE_MODELS)) {
    throw createError({ statusCode: 400, message: `Revert not supported for type: ${type}` })
  }

  const { ids, mode } = await readBody<{ ids: string[]; mode: 'undo' | 'undo-resolved' }>(event)
  if (!Array.isArray(ids) || ids.length === 0) {
    throw createError({ statusCode: 400, message: 'ids must be a non-empty array' })
  }
  if (!['undo', 'undo-resolved'].includes(mode)) {
    throw createError({ statusCode: 400, message: "mode must be 'undo' or 'undo-resolved'" })
  }

  const model = REVERTABLE_MODELS[type]
  const result = await (prisma[model] as any).updateMany({
    where: { id: { in: ids }, status: 'RESOLVED' },
    data: { status: 'PENDING_REVERT', updatedAt: new Date() },
  })

  return { queued: result.count, mode }
})
