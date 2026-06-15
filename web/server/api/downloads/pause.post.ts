import { requirePermission } from '~/server/utils/permissions'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { setDownloadsPaused, freeGb } from '~/server/utils/pauseState'

// Toggle the global downloads pause. Pausing is always allowed (manual). Resuming is refused while the
// disk is still below the free-space floor — it re-pauses (disk-full) and returns 409.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const body = await readBody(event)
  if (typeof body?.paused !== 'boolean') {
    throw createError({ statusCode: 400, message: 'paused (boolean) required' })
  }

  if (body.paused) {
    await setDownloadsPaused(true, 'manual')
    return { paused: true, reason: 'manual' }
  }

  // Resume: block if the disk is still full.
  const { downloadsPath } = await resolveDownloadSettings()
  const { downloadsMinFreeGb } = await resolveMonitorSettings()
  const free = await freeGb(downloadsPath)
  if (free >= 0 && free < downloadsMinFreeGb) {
    await setDownloadsPaused(true, 'disk-full')
    throw createError({ statusCode: 409, message: `Disk still full — ${free.toFixed(1)} GB free (need ${downloadsMinFreeGb} GB). Free space, then continue.` })
  }
  await setDownloadsPaused(false, null)
  return { paused: false, reason: null }
})
