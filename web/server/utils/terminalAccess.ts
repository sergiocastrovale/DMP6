// Authorization decisions for the terminal control endpoints (stop / unlock / reconnect / sessions).
// Pure and dependency-free so the decision is unit-testable without an H3 event; the endpoints turn the
// returned gate into requireRole/requirePermission calls through enforceTerminalGate.
import type { PermissionKey } from './permissions'
import { hasDestructiveFlag, permissionForCommand } from './terminalCommand'

export type TerminalAction = 'stop' | 'unlock' | 'view'

export type TerminalGate =
  | { kind: 'role', role: 'ADMIN' }
  | { kind: 'permission', key: PermissionKey }

export interface TerminalRunMeta {
  command: string
  args: string[]
}

// Clearing the scan lock and killing every session is `terminal.control` (ADMIN-only by default, delegable).
// Stopping a run needs at least what it took to start it: a MANAGER can stop their own ./index but not an
// ADMIN's ./nuke or `--overwrite` rescan. A run with no recorded metadata (started before this existed,
// or from outside the web app) falls back to the baseline `sync.run`.
export const gateForTerminalAction = (action: TerminalAction, run: TerminalRunMeta | null): TerminalGate => {
  if (action === 'unlock') {
    return { kind: 'permission', key: 'terminal.control' }
  }
  if (action === 'view') {
    return { kind: 'permission', key: 'sync.view' }
  }
  if (!run) {
    return { kind: 'permission', key: 'sync.run' }
  }
  const required = permissionForCommand(run.command)
  return required === 'ADMIN' || hasDestructiveFlag(run.args)
    ? { kind: 'role', role: 'ADMIN' }
    : { kind: 'permission', key: required ?? 'sync.run' }
}



export const parseTerminalRunMeta = (raw: string | null): TerminalRunMeta | null => {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalRunMeta>
    return typeof parsed.command === 'string' && Array.isArray(parsed.args)
      ? { command: parsed.command, args: parsed.args.map(String) }
      : null
  }
  catch {
    return null
  }
}
