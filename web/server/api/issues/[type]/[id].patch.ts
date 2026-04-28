import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

const MODEL_MAP = {
  corrupted: 'issueCorruptedTpe2',
  unsplit: 'issueUnsplitArtist',
  orphans: 'issueOrphanArtist',
  duplicates: 'issueDuplicateArtist',
  missing: 'issueMissingMetadata',
} as const

type IssueType = keyof typeof MODEL_MAP

const ALLOWED_FIELDS: Record<IssueType, string[]> = {
  corrupted: ['proposedValue'],
  unsplit: ['proposedParts'],
  orphans: [],
  duplicates: [],
  missing: ['proposedValues'],
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const type = getRouterParam(event, 'type') as IssueType
  const id = getRouterParam(event, 'id')!

  if (!(type in MODEL_MAP)) {
    throw createError({ statusCode: 404, message: `Unknown issue type: ${type}` })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const allowed = ALLOWED_FIELDS[type]

  const data: Record<string, unknown> = { updatedAt: new Date() }
  for (const field of allowed) {
    if (field in body) {
      data[field] = body[field]
    }
  }

  if (Object.keys(data).length === 1) {
    throw createError({ statusCode: 400, message: 'No valid fields to update' })
  }

  const model = MODEL_MAP[type]
  const updated = await (prisma[model] as any).update({
    where: { id },
    data,
  })

  return updated
})
