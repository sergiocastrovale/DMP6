import { prisma } from '~/server/utils/prisma'
import { findReconnectableSessions } from '~/server/utils/tmuxSessions'
import type { ScanStatus } from '~/types/scan'

export default defineEventHandler(async (): Promise<ScanStatus> => {
  const stats = await prisma.statistics.findUnique({
    where: { id: 'main' },
    select: {
      lastScanStartedAt: true,
      lastScanEndedAt: true,
      lastSyncedArtist: true,
      lastIndexedFolder: true,
      scanLockedBy: true,
      scanLockedAt: true,
      scanPid: true,
    },
  })

  const lockedBy = stats?.scanLockedBy ?? null

  return {
    isRunning: !!lockedBy,
    lockedBy,
    lockedAt: stats?.scanLockedAt?.toISOString() ?? null,
    pid: stats?.scanPid ?? null,
    args: null,
    // Best-effort single-session convenience for this endpoint's existing simple UI
    // (RealTimeStatus.vue/FirstScan.vue) - NOT derived from scanLockedBy (that only names the
    // currently-executing binary, never the tmux session name, and is wrong for every custom session:
    // every per-artist action and wrapper script like ./refresh). When more than one session is live
    // this only ever surfaces one of them; the real multi-session source of truth is
    // GET /api/terminal/sessions, which stores/terminal.ts's autoReconnectOrphan() actually uses.
    sessionName: (await findReconnectableSessions())[0]?.session ?? null,
    lastScanStartedAt: stats?.lastScanStartedAt?.toISOString() ?? null,
    lastScanEndedAt: stats?.lastScanEndedAt?.toISOString() ?? null,
    lastIndexedFolder: stats?.lastIndexedFolder ?? null,
    lastSyncedArtist: stats?.lastSyncedArtist ?? null,
  }
})
