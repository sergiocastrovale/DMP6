import { requirePermission } from '~/server/utils/permissions'
import { cleanupReadyDownloads, sweepDanglingDownloads } from '~/server/utils/promote'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  // Dangling-row GC is a pure DB operation (no volume dependency) — always run it, even on a dev
  // instance without the downloads mount, before the ready-orphan sweep (which requires the mount).
  const { removed: danglingRemoved } = await sweepDanglingDownloads()
  const result = await cleanupReadyDownloads()
  return { success: true, danglingRemoved, ...result }
})
