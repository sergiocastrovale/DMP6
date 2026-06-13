import { requirePermission } from '~/server/utils/permissions'
import { scanMissingAndDownload } from '~/server/utils/autoDownload'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const body = await readBody(event).catch(() => ({})) as { limit?: number; artistId?: string }
  const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(100, body.limit!)) : 10

  return scanMissingAndDownload({ limit, artistId: body.artistId })
})
