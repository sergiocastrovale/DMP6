import { requirePermission } from '~/server/utils/permissions'
import { forceRetryDownloads } from '~/server/utils/autoDownload'

// Bulk "Retry" for a multi-select in the Queue tab.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const body = await readBody(event).catch(() => ({})) as { ids?: string[] }
  const ids = Array.isArray(body.ids) ? body.ids : []
  if (!ids.length) {
    return { retried: 0, failed: 0 }
  }

  return forceRetryDownloads(ids)
})
