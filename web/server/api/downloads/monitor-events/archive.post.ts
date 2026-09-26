import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { idsBodySchema } from '~/server/schemas/common'
import { archiveMonitorEvents } from '~/server/utils/monitorEvents'

// Dismiss monitor issues from the flagged list. Reversible via restore.post.ts, which is why the UI
// needs no confirmation dialog for it.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const { ids } = await readBodyOf(event, idsBodySchema)

  return { archived: await archiveMonitorEvents(ids) }
})
