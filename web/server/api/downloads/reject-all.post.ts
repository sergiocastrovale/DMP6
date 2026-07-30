import { requirePermission } from '~/server/utils/permissions'
import { forceRejectDownloadedReleases } from '~/server/utils/promote'

// Bulk reject: always terminal (REJECTED), bypassing the attempts cap that the single-row reject
// endpoint uses — see forceRejectDownloadedReleases for why.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const body = await readBody(event).catch(() => ({})) as { ids?: string[] }
  const ids = Array.isArray(body.ids) ? body.ids : []
  if (!ids.length) {
    return { rejected: 0 }
  }

  return forceRejectDownloadedReleases(ids)
})
