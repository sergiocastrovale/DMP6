import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { runExclusive } from '~/server/utils/scriptLock'

// Where the Rust binaries live and how the web app runs them. One place, so an `index`/`sync`/`tidy` started
// by the terminal, the auto-scan, a merge or the gaps worker all resolve the same directory - they previously
// each had their own fallback chain (`PROJECT_ROOT!`, `process.cwd()`, `'.'`).
export const projectRoot = (): string => process.env.PROJECT_ROOT || process.cwd()
export const scriptsDir = (): string => process.env.SCRIPTS_DIR || projectRoot()
export const scriptPath = (name: string): string => join(scriptsDir(), name)

export const DEFAULT_TAIL_LINES = 50

export interface RunScriptOptions {
  // Serialize against every other in-process script run (they share one exclusive DB scan lock, and the binaries
  // hard-exit when it is held). Leave off when the caller is already inside runExclusive.
  exclusive?: boolean
  // How many trailing output lines to keep for the error message / result.
  tailLines?: number
  onLine?: (line: string) => void
  signal?: AbortSignal
}

export interface RunScriptResult {
  code: number
  tail: string[]
}

export class ScriptError extends Error {
  code: number | null
  tail: string[]
  constructor(message: string, code: number | null, tail: string[]) {
    super(message)
    this.name = 'ScriptError'
    this.code = code
    this.tail = tail
  }
}

// Runs a binary and STREAMS its output line by line, keeping only the last few lines.
//
// The `execFile` this replaces buffered all stdout+stderr in memory and KILLED the child the moment it exceeded
// `maxBuffer` (64 MB). An unattended ./index over 2M files prints far more than that, so the scan was aborted
// mid-run - while holding the DB scan lock. Streaming has no size ceiling and bounded memory.
export const runScript = (name: string, args: string[] = [], options: RunScriptOptions = {}): Promise<RunScriptResult> => {
  const run = () => new Promise<RunScriptResult>((resolve, reject) => {
    const limit = options.tailLines ?? DEFAULT_TAIL_LINES
    const tail: string[] = []
    const push = (line: string) => {
      tail.push(line)
      if (tail.length > limit) {tail.shift()}
      options.onLine?.(line)
    }

    const child = spawn(scriptPath(name), args, { cwd: projectRoot(), stdio: ['ignore', 'pipe', 'pipe'] })
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', push)
    }

    const onAbort = () => child.kill('SIGTERM')
    if (options.signal?.aborted) {onAbort()}
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort)
      reject(new ScriptError(`failed to start ${name}: ${error.message}`, null, tail))
    })
    child.on('close', (code, signal) => {
      options.signal?.removeEventListener('abort', onAbort)
      if (code === 0) {
        resolve({ code, tail })
        return
      }
      const last = [...tail].reverse().find(l => l.trim())
      reject(new ScriptError(
        `${name} ${signal ? `was killed by ${signal}` : `exited with code ${code}`}${last ? ` - ${last}` : ''}`,
        code,
        tail,
      ))
    })
  })

  return options.exclusive ? runExclusive(run) : run()
}
