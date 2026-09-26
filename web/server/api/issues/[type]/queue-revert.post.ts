import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { revertBodySchema } from '~/server/schemas/issues'
import type { HistoryIssueType as RevertableType } from '~/types/issues'

const REVERTABLE_MODELS = {
  corrupted: 'issueCorruptedTpe2',
  missing: 'issueMissingMetadata',
} as const satisfies Record<RevertableType, string>

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.fix')

  const type = getRouterParam(event, 'type') as RevertableType
  if (!(type in REVERTABLE_MODELS)) {
    throw createError({ statusCode: 400, message: `Revert not supported for type: ${type}` })
  }

  const { ids, mode } = await readBodyOf(event, revertBodySchema)

  const model = REVERTABLE_MODELS[type]
  const result = await (prisma[model] as any).updateMany({
    where: { id: { in: ids }, status: 'RESOLVED' },
    data: { status: 'PENDING_REVERT', updatedAt: new Date() },
  })

  return { queued: result.count, mode }
})
