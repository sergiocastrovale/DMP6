// A self-scheduling poll loop that respects tab visibility.
//
// `setInterval` keeps firing in a background tab and doesn't care whether the previous request finished, so
// an open-but-forgotten page kept hammering heavy endpoints (the downloads queue ran every 2 s for as long as
// acquisition was enabled - which is always). This chain instead:
//   - waits `delay()` ms AFTER each run completes (no overlap, no pile-up on a slow server);
//   - asks `delay()` again every time, so cadence follows state (fast while something moves, slow when idle) and
//     `null` stops the loop entirely;
//   - parks while the document is hidden and runs immediately when it becomes visible again.
// The slice of `document` the poller needs.
export interface VisibilityDoc {
  readonly hidden: boolean
  addEventListener: (type: 'visibilitychange', listener: () => void) => void
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void
}

export interface PollerOptions {
  run: () => Promise<unknown> | unknown
  // Milliseconds until the next run, or null to stop polling.
  delay: () => number | null
  // Injectable for tests; defaults to the browser's document (absent on the server).
  doc?: VisibilityDoc
}

export interface Poller {
  start: () => void
  stop: () => void
  // Re-evaluates delay() now - call when state changed in a way that should speed up (or stop) the loop
  // instead of waiting out the currently scheduled wait.
  reschedule: () => void
  readonly active: boolean
}

export const createPoller = ({ run, delay, doc = typeof document === 'undefined' ? undefined : document }: PollerOptions): Poller => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let active = false
  let running = false

  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = () => {
    clear()
    const ms = delay()
    if (ms === null) {
      // Nothing left to watch: stop cleanly so start() works again later.
      active = false
      doc?.removeEventListener('visibilitychange', onVisibilityChange)
      return
    }
    timer = setTimeout(tick, ms)
  }

  const tick = async () => {
    timer = null
    if (!active) {return}
    if (doc?.hidden) {return} // parked until the tab is visible again
    running = true
    try {
      await run()
    }
    catch { /* a failed poll just tries again next round */ }
    running = false
    if (active) {schedule()}
  }

  const onVisibilityChange = () => {
    if (active && !doc?.hidden && !timer && !running) {
      void tick()
    }
  }

  return {
    start: () => {
      if (active) {return}
      active = true
      doc?.addEventListener('visibilitychange', onVisibilityChange)
      schedule()
    },
    stop: () => {
      active = false
      clear()
      doc?.removeEventListener('visibilitychange', onVisibilityChange)
    },
    reschedule: () => {
      if (active && !running) {schedule()}
    },
    get active() {
      return active
    },
  }
}
