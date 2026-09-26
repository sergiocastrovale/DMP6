import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { issuePatchBodySchema } from '~/server/schemas/issues'
import { requireIssueType } from '~/server/utils/issueTypes'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.fix')

  const def = requireIssueType(getRouterParam(event, 'type'), { fixable: true })
  const id = getRouterParam(event, 'id')!

  const body = await readBodyOf(event, issuePatchBodySchema)
  const data: Record<string, unknown> = { updatedAt: new Date() }
  for (const field of def.patchableFields) {
    if (field in body) {
      data[field] = body[field]
    }
  }

  if (Object.keys(data).length === 1) {
    throw createError({ statusCode: 400, message: 'No valid fields to update' })
  }

  const updated = await def.delegate.update({
    where: { id },
    data,
  })

  return updated
})
