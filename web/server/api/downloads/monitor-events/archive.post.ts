import { requirePermission } from '~/server/utils/permissions'
import { archiveMonitorEvents } from '~/server/utils/monitorEvents'

// Dismiss monitor issues from the flagged list. Reversible via restore.post.ts, which is why the UI
// needs no confirmation dialog for it.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const { ids } = await readBody<{ ids?: string[] }>(event) ?? {}
  if (!Array.isArray(ids) || ids.length === 0) {
    throw createError({ statusCode: 400, message: 'ids required' })
  }

  return { archived: await archiveMonitorEvents(ids) }
})
