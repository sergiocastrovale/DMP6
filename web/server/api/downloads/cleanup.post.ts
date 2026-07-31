import { requirePermission } from '~/server/utils/permissions'
import { cleanupReadyDownloads, sweepDanglingDownloads } from '~/server/utils/promote'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  // Dangling-row GC is a pure DB operation (no volume dependency) — always run it, even on a dev
  // instance without the downloads mount, before the ready-orphan sweep (which requires the mount).
  const { removed: danglingRemoved } = await sweepDanglingDownloads()
  const result = await cleanupReadyDownloads()
  return { success: true, danglingRemoved, ...result }
})
