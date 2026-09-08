import { requirePermission } from '~/server/utils/permissions'
import { isDownloadsEnabled } from '~/server/utils/acquisitionStatus'
import { checkDownloadEnvironment, acquireBlockReasons, mergeBlockReasons } from '~/server/utils/downloadEnvironment'
import type { DownloadEnvironment } from '~/types/download'

// Whether Soulseek acquisition is switched on, plus whether this instance can physically acquire/
// merge (mounted volumes, ffmpeg, slskd reachability — see downloadEnvironment.ts). Drives the
// /downloads header + the artist-page download/merge button gates.
export default defineEventHandler(async (event): Promise<{ enabled: boolean, canAcquire: boolean, canMerge: boolean, environment: DownloadEnvironment }> => {
  await requirePermission(event, 'sync.view')
  const enabled = await isDownloadsEnabled()
  const environment = await checkDownloadEnvironment()
  return {
    enabled,
    canAcquire: enabled && acquireBlockReasons(environment).length === 0,
    canMerge: mergeBlockReasons(environment).length === 0,
    environment,
  }
})
