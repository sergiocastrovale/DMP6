import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

// Where a terminal run keeps its files. One place, so run/reconnect/stop/sessions can't disagree about it.
// Per session name: the tee'd output log (also the SSE source and the DMP_EXIT sentinel carrier), the wrapper
// script tmux executes, and the command metadata `stop` gates on (server/utils/terminalAccess.ts).
//
// These lived in /tmp: world-readable, shared with every other process on the host, and never cleaned. A run's
// output can contain artist/library paths and script arguments, so they now sit in the app's own log directory
// (the same LOG_DIR monitor.log uses - a mounted volume in the container), owner-only, and are pruned by age.
export const TERMINAL_FILE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

// Resolved per call rather than at module load, so LOG_DIR/PROJECT_ROOT changes (and tests) take effect.
export const terminalDir = (): string =>
  join(process.env.LOG_DIR || join(process.env.PROJECT_ROOT || process.cwd(), 'data', 'logs'), 'terminal')

export const terminalLogPath = (session: string): string => join(terminalDir(), `dmp-${session}.log`)
export const terminalScriptPath = (session: string): string => join(terminalDir(), `dmp-${session}.sh`)
export const terminalMetaPath = (session: string): string => join(terminalDir(), `dmp-${session}.json`)

// Owner-only: the directory holds command lines and script output.
export const ensureTerminalDir = async (): Promise<void> => {
  await mkdir(terminalDir(), { recursive: true, mode: 0o700 })
}

// Deletes terminal files not touched for `maxAgeMs`. Best-effort, and it only ever looks at dmp-*.{log,sh,json}
// inside the terminal directory. A session that is still running keeps appending to its log, so its mtime stays
// fresh and it is never pruned out from under a live run.
export const pruneTerminalFiles = async (now: number = Date.now(), maxAgeMs: number = TERMINAL_FILE_MAX_AGE_MS): Promise<number> => {
  const dir = terminalDir()
  let removed = 0
  let names: string[]
  try {
    names = await readdir(dir)
  }
  catch {
    return 0
  }
  for (const name of names) {
    if (!/^dmp-[a-zA-Z0-9_-]+\.(log|sh|json)$/.test(name)) {continue}
    const file = join(dir, name)
    try {
      const { mtimeMs } = await stat(file)
      if (now - mtimeMs > maxAgeMs) {
        await unlink(file)
        removed++
      }
    }
    catch { /* raced with another prune or a run - leave it */ }
  }
  return removed
}
