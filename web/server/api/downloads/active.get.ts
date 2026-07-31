import { requirePermission } from '~/server/utils/permissions'
import { getAllActiveDownloads } from '~/server/utils/downloads'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const downloads = await getAllActiveDownloads()
  return { downloads }
})
