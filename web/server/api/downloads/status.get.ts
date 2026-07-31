import { requirePermission } from '~/server/utils/permissions'
import { getDownloadStatus } from '~/server/utils/downloads'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  return getDownloadStatus()
})
