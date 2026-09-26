import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { revertBodySchema } from '~/server/schemas/issues'
import { requireIssueType } from '~/server/utils/issueTypes'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.fix')

  const def = requireIssueType(getRouterParam(event, 'type'), { revertable: true })

  const { ids, mode } = await readBodyOf(event, revertBodySchema)

  const result = await def.delegate.updateMany({
    where: { id: { in: ids }, status: 'RESOLVED' },
    data: { status: 'PENDING_REVERT', updatedAt: new Date() },
  })

  return { queued: result.count, mode }
})
