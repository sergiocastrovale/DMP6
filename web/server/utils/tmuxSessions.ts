import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { hasUnfinishedRun, SESSION_NAME_RE } from '~/server/utils/terminalCommand'
import { terminalLogPath } from '~/server/utils/terminalPaths'

// tmux/fs-dependent, deliberately separate from terminalCommand.ts (kept dependency-free by its own
// design - see its header). These functions are the single source of truth for "what DMP session(s)
// are actually alive right now", replacing the old approach of guessing a session name from
// Statistics.scanLockedBy (wrong for any custom session name - every per-artist action and every
// wrapper script like ./refresh - see docs/specs and stores/terminal.ts's reconnect flow).
//
// Everything here is async. The reconnect poll (every tab, every 15 s) and /api/scan/status (every 3 s during
// a run) call findReconnectableSessions, and the previous execSync + readFileSync-of-the-whole-log version
// blocked the event loop - and read tens of megabytes of `./index` output into memory - each time.

// The sentinel is the last line the run's EXIT trap writes, so the tail is all it takes to know a run finished.
export const LOG_TAIL_BYTES = 1024

const run = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {reject(error)}
      else {resolve(String(stdout))}
    })
  })

export async function tmuxAvailable(): Promise<boolean> {
  try {
    await run('tmux', ['-V'])
    return true
  }
  catch {
    return false
  }
}

// The tmux session is created with the wrapper script as its command, so it disappears the moment
// that script exits (cleanly, crashed, or killed). A live session is therefore the only proof a run
// is still going - a sentinel-less log on its own only proves the *last* run didn't write one.
export async function tmuxSessionAlive(session: string): Promise<boolean> {
  try {
    await run('tmux', ['has-session', '-t', session])
    return true
  }
  catch {
    return false
  }
}

// Starts a detached session running `scriptFile`. `scriptFile` is a path this server wrote itself (never user
// input) and is passed as an argv element, not through a shell.
export async function startTmuxSession(session: string, scriptFile: string): Promise<void> {
  await run('tmux', ['new-session', '-d', '-s', session, scriptFile])
}

// Force Unlock's whole point is a nuclear "get me unstuck" override - it must free the session name,
// not just the DB lock row, or the very next run with that name 409s right back (the bug this exists
// to fix). Best-effort: a session that already died leaves nothing to kill.
export async function killTmuxSession(session: string): Promise<void> {
  try {
    await run('tmux', ['kill-session', '-t', session])
  }
  catch { /* already gone */ }
}

// Every live tmux session name, or [] when tmux isn't running/has no sessions (tmux exits non-zero in
// both cases - neither is an error worth surfacing, just "nothing to report").
export async function listTmuxSessions(): Promise<string[]> {
  try {
    const out = await run('tmux', ['list-sessions', '-F', '#{session_name}'])
    return out.split('\n').map(l => l.trim()).filter(Boolean)
  }
  catch {
    return []
  }
}

export interface LogTail {
  // The last LOG_TAIL_BYTES of the file (or all of it, if smaller).
  tail: string
  startedAt: Date
}

// Reads only the end of a log. `null` when the file doesn't exist (or can't be read).
export async function readLogTail(file: string, bytes: number = LOG_TAIL_BYTES): Promise<LogTail | null> {
  let handle
  try {
    handle = await open(file, 'r')
    const { size, birthtime } = await handle.stat()
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    if (length > 0) {
      await handle.read(buffer, 0, length, size - length)
    }
    return { tail: buffer.toString('utf8'), startedAt: birthtime }
  }
  catch {
    return null
  }
  finally {
    await handle?.close().catch(() => {})
  }
}

// Whether the session's previous log shows a run that never wrote its DMP_EXIT sentinel.
export async function hasUnfinishedLog(session: string): Promise<boolean> {
  const log = await readLogTail(terminalLogPath(session))
  return hasUnfinishedRun(log ? log.tail : null)
}

export interface ReconnectableSession {
  session: string
  startedAt: string | null
}

// The real source of truth for "what can I reconnect to", replacing the Statistics.scanLockedBy
// guess. Self-cleaning by construction: buildScript's EXIT trap (terminalCommand.ts) already kills
// its own tmux session once it writes the DMP_EXIT sentinel, so a finished run just stops appearing
// here on its own - no separate cleanup path, no persisted state, no migration.
export async function findReconnectableSessions(): Promise<ReconnectableSession[]> {
  const sessions: ReconnectableSession[] = []
  for (const name of await listTmuxSessions()) {
    if (!SESSION_NAME_RE.test(name)) {continue}
    const log = await readLogTail(terminalLogPath(name))
    if (!log || !hasUnfinishedRun(log.tail)) {continue}
    sessions.push({ session: name, startedAt: log.startedAt.toISOString() })
  }
  return sessions
}
