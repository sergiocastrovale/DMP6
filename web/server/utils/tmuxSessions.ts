import { execSync } from 'child_process'
import fs from 'fs'
import { hasUnfinishedRun, SESSION_NAME_RE } from '~/server/utils/terminalCommand'

// tmux/fs-dependent, deliberately separate from terminalCommand.ts (kept dependency-free by its own
// design - see its header). These functions are the single source of truth for "what DMP session(s)
// are actually alive right now", replacing the old approach of guessing a session name from
// Statistics.scanLockedBy (wrong for any custom session name - every per-artist action and every
// wrapper script like ./refresh - see docs/specs and stores/terminal.ts's reconnect flow).

export function tmuxAvailable(): boolean {
  try {
    execSync('tmux -V', { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

// The tmux session is created with the wrapper script as its command, so it disappears the moment
// that script exits (cleanly, crashed, or killed). A live session is therefore the only proof a run
// is still going - a sentinel-less log on its own only proves the *last* run didn't write one.
export function tmuxSessionAlive(session: string): boolean {
  try {
    execSync(`tmux has-session -t "${session}" 2>/dev/null`, { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

// Force Unlock's whole point is a nuclear "get me unstuck" override - it must free the session name,
// not just the DB lock row, or the very next run with that name 409s right back (the bug this exists
// to fix). Best-effort: a session that already died leaves nothing to kill.
export function killTmuxSession(session: string): void {
  try {
    execSync(`tmux kill-session -t "${session}" 2>/dev/null || true`)
  }
  catch { /* already gone */ }
}

// Every live tmux session name, or [] when tmux isn't running/has no sessions (execSync throws in
// both cases - neither is an error worth surfacing, just "nothing to report").
export function listTmuxSessions(): string[] {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf8' })
    return out.split('\n').map(l => l.trim()).filter(Boolean)
  }
  catch {
    return []
  }
}

export interface ReconnectableSession {
  session: string
  startedAt: string | null
}

// The real source of truth for "what can I reconnect to", replacing the Statistics.scanLockedBy
// guess. Self-cleaning by construction: buildScript's EXIT trap (terminalCommand.ts) already kills
// its own tmux session once it writes the DMP_EXIT sentinel, so a finished run just stops appearing
// here on its own - no separate cleanup path, no persisted state, no migration.
export function findReconnectableSessions(): ReconnectableSession[] {
  const sessions: ReconnectableSession[] = []
  for (const name of listTmuxSessions()) {
    if (!SESSION_NAME_RE.test(name)) {continue}
    const logFile = `/tmp/dmp-${name}.log`
    if (!fs.existsSync(logFile)) {continue}
    let content: string
    let startedAt: string | null
    try {
      content = fs.readFileSync(logFile, 'utf8')
      startedAt = fs.statSync(logFile).birthtime.toISOString()
    }
    catch {
      continue
    }
    if (!hasUnfinishedRun(content)) {continue}
    sessions.push({ session: name, startedAt })
  }
  return sessions
}
