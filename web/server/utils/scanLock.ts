import { readFileSync } from 'node:fs'
import { prisma } from '~/server/utils/prisma'
import { findReconnectableSessions, killTmuxSession } from '~/server/utils/tmuxSessions'

// Binaries that call common::lock::acquire_lock
// (scripts/{index,sync,fix,delete,nuke,playlists,add,tidy}/src/main.rs) - the only values
// Statistics.scanLockedBy can ever hold. Keep in sync with those call sites
// (`grep -rl acquire_lock scripts/*/src/main.rs`).
export const KNOWN_LOCK_BINARIES = new Set(['index', 'sync', 'fix', 'delete', 'nuke', 'playlists', 'add', 'tidy'])

// True when `comm` (a /proc/<pid>/comm read) names the expected lock-holding binary. Extracted from
// the fs read below so the matching logic is unit-testable without a real /proc filesystem.
export const commMatchesBinary = (comm: string, expectedBinary: string | null): boolean =>
  expectedBinary !== null && KNOWN_LOCK_BINARIES.has(expectedBinary) && comm.trim() === expectedBinary

// Best-effort check that `pid` is actually one of our own script processes running in THIS
// container's PID namespace, matching Statistics.scanLockedBy. scanPid is a bare number with no
// recorded origin - scripts can be started from a different machine/container sharing the same DB
// (docker-compose.yml documents a dev box pointed at the same DATABASE_URL), so signalling it blindly
// can hit an unrelated process that happens to reuse that PID number in this namespace.
export const isOwnScanProcess = (pid: number, expectedBinary: string | null): boolean => {
  try {
    const comm = readFileSync(`/proc/${pid}/comm`, 'utf8')
    return commMatchesBinary(comm, expectedBinary)
  }
  catch {
    return false
  }
}

export interface ClearScanLockOptions {
  // SIGTERM the lock holder - only ever a PID verified (isOwnScanProcess) to be one of our own script processes.
  signalOwn?: boolean
  // Clear the row only when the holder was verified as ours. A lock owned by another machine/container sharing the
  // database is not ours to clear from a plain "stop"; an explicit admin unlock passes false and always clears.
  onlyIfOwn?: boolean
  // Also kill every live reconnectable tmux session: clearing the row alone leaves the session that blocked the run
  // alive, so the next run with the same name 409s right back.
  killSessions?: boolean
}

// The one way the scan lock is cleared (terminal stop, the admin "unlock" and the force-unlock button).
export const clearScanLock = async ({ signalOwn = false, onlyIfOwn = false, killSessions = false }: ClearScanLockOptions = {}): Promise<{ cleared: boolean, owned: boolean }> => {
  const stats = await prisma.statistics.findUnique({
    where: { id: 'main' },
    select: { scanPid: true, scanLockedBy: true },
  })
  const owned = stats?.scanPid != null && isOwnScanProcess(stats.scanPid, stats.scanLockedBy)

  if (owned && signalOwn) {
    try {
      process.kill(stats!.scanPid!, 'SIGTERM')
    }
    catch { /* pid already dead - fine */ }
  }

  const cleared = !onlyIfOwn || owned
  if (cleared) {
    await prisma.statistics.update({
      where: { id: 'main' },
      data: { scanLockedBy: null, scanLockedAt: null, scanPid: null, updatedAt: new Date() },
    })
  }

  if (killSessions) {
    for (const s of await findReconnectableSessions()) {
      await killTmuxSession(s.session)
    }
  }

  return { cleared, owned }
}
