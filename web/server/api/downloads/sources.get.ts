import { requirePermission } from '~/server/utils/permissions'
import { getDownloadSources, ensureDownloadSources } from '~/server/utils/downloadSources'
import type { DownloadSourceConfigItem } from '~/types/download'

// The DownloadSources config rows (RuTracker + Soulseek), driving the /downloads header switches.
export default defineEventHandler(async (event): Promise<{ sources: DownloadSourceConfigItem[] }> => {
  await requirePermission(event, 'sync.view')
  await ensureDownloadSources()
  const sources = await getDownloadSources()
  return { sources }
})
