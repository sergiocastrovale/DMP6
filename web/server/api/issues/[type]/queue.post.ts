import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { idsBodySchema } from '~/server/schemas/common'
import { requireIssueType } from '~/server/utils/issueTypes'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.fix')

  const def = requireIssueType(getRouterParam(event, 'type'), { fixable: true })

  const { ids } = await readBodyOf(event, idsBodySchema)

  const result = await def.delegate.updateMany({
    where: { id: { in: ids }, status: 'DETECTED' },
    data: { status: 'PENDING', updatedAt: new Date() },
  })

  return { queued: result.count }
})
