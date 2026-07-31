import { readFileSync } from 'node:fs'

// Binaries that call common::lock::acquire_lock (scripts/{index,sync,fix,delete,nuke}/src/main.rs) -
// the only values Statistics.scanLockedBy can ever hold. Keep in sync with those call sites.
export const KNOWN_LOCK_BINARIES = new Set(['index', 'sync', 'fix', 'delete', 'nuke'])

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
