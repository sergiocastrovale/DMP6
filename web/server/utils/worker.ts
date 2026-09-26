import { monitorLog } from '~/server/utils/monitorLog'
import { errorMessage } from '~/helpers/functions'

// The monitor loop's independent workers (reconcile, top-up, gaps, auto-merge) all followed the same recipe by hand: a
// module-level "running" flag so ticks never overlap, a "last run" stamp so the work is throttled to its own cadence,
// try/catch/finally around the body, and a log line when something went wrong. This is that recipe once.

export const SLOW_WORKER_MS = 30_000

export interface WorkerOptions {
  name: string
  // Minimum gap between runs. A function is asked on every tick, so the cadence can follow a live setting.
  minIntervalMs?: number | (() => number | Promise<number>)
  // Cheap preconditions (paused? disabled?). False skips the tick without stamping the throttle.
  shouldRun?: () => boolean | Promise<boolean>
  run: () => Promise<void>
  log?: (level: 'notice' | 'warn' | 'error', message: string) => void
  now?: () => number
}

export interface Worker {
  // Resolves once this tick is done (or was skipped). Never rejects: a failing run is logged, not thrown.
  tick: () => Promise<void>
  isRunning: () => boolean
  // Test seam: forget the last run so the next tick is not throttled.
  reset: () => void
}

export const createWorker = ({ name, minIntervalMs = 0, shouldRun, run, log = monitorLog, now = Date.now }: WorkerOptions): Worker => {
  let running = false
  let lastRunAt = 0

  const tick = async (): Promise<void> => {
    if (running) {return}
    if (shouldRun && !(await shouldRun())) {return}
    const interval = typeof minIntervalMs === 'function' ? await minIntervalMs() : minIntervalMs
    // Re-checked after the awaits above: another tick may have started while this one was waiting on them.
    if (running || now() - lastRunAt < interval) {return}

    running = true
    const started = now()
    lastRunAt = started
    try {
      await run()
    }
    catch (e) {
      log('error', `${name} failed: ${errorMessage(e)}`)
    }
    finally {
      running = false
      const took = now() - started
      if (took > SLOW_WORKER_MS) {
        log('warn', `${name} took ${Math.round(took / 1000)}s`)
      }
    }
  }

  return { tick, isRunning: () => running, reset: () => { lastRunAt = 0 } }
}
