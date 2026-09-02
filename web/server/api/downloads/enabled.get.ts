import { requirePermission } from '~/server/utils/permissions'
import { isDownloadsEnabled } from '~/server/utils/acquisitionStatus'

// Whether Soulseek acquisition is switched on. Drives the /downloads header + the artist-page
// download button gate.
export default defineEventHandler(async (event): Promise<{ enabled: boolean }> => {
  await requirePermission(event, 'sync.view')
  return { enabled: await isDownloadsEnabled() }
})
