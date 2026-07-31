import { requirePermission } from '~/server/utils/permissions'
import { requeueRejectedDownloads } from '~/server/utils/promote'

// Bulk "Move all back to queue" for the Rejected tab.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const body = await readBody(event).catch(() => ({})) as { ids?: string[] }
  const ids = Array.isArray(body.ids) ? body.ids : []
  if (!ids.length) {
    return { requeued: 0 }
  }

  return requeueRejectedDownloads(ids)
})
