import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import type { FixableIssueType as IssueType } from '~/types/issues'

const MODEL_MAP = {
  corrupted: 'issueCorruptedTpe2',
  orphans: 'issueOrphanArtist',
  duplicates: 'issueDuplicateArtist',
  missing: 'issueMissingMetadata',
} as const satisfies Record<IssueType, string>

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const type = getRouterParam(event, 'type') as IssueType
  if (!(type in MODEL_MAP)) {
    throw createError({ statusCode: 404, message: `Unknown issue type: ${type}` })
  }

  const { ids } = await readBody<{ ids: string[] }>(event)
  if (!Array.isArray(ids) || ids.length === 0) {
    throw createError({ statusCode: 400, message: 'ids must be a non-empty array' })
  }

  const model = MODEL_MAP[type]
  const result = await (prisma[model] as any).updateMany({
    where: { id: { in: ids }, status: 'DETECTED' },
    data: { status: 'PENDING', updatedAt: new Date() },
  })

  return { queued: result.count }
})
