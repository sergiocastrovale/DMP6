import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'
import { isOwnScanProcess } from '~/server/utils/scanLock'
import { findReconnectableSessions, killTmuxSession } from '~/server/utils/tmuxSessions'

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const stats = await prisma.statistics.findUnique({
    where: { id: 'main' },
    select: { scanPid: true, scanLockedBy: true },
  })

  // Only signal a PID verified to be one of our own script processes in this namespace - it may
  // belong to a different machine/container sharing the same DB. The DB lock row is always cleared
  // below regardless: this is an explicit admin override for a lock the UI already reports as stale.
  if (stats?.scanPid != null && isOwnScanProcess(stats.scanPid, stats.scanLockedBy)) {
    try {
      process.kill(stats.scanPid, 'SIGTERM')
    }
    catch { /* pid already dead - that's fine */ }
  }

  await prisma.statistics.update({
    where: { id: 'main' },
    data: { scanLockedBy: null, scanLockedAt: null, scanPid: null },
  })

  // Same reasoning as terminal/unlock.post.ts: clearing the DB row alone leaves the tmux session
  // itself alive, so the next run with the same session name 409s right back.
  for (const s of findReconnectableSessions()) {
    killTmuxSession(s.session)
  }

  return { ok: true }
})
