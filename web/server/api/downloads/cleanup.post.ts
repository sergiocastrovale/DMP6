import { requirePermission } from '~/server/utils/permissions'
import { cleanupReadyDownloads } from '~/server/utils/promote'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const result = await cleanupReadyDownloads()
  return { success: true, ...result }
})
