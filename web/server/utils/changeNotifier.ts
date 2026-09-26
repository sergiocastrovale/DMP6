// Tells listeners "something changed" without saying what: they re-read. Notifications are coalesced - the first one in a
// quiet period starts a `settleMs` timer, everything until it fires folds into the same delivery - so a burst of writes
// is one message, and the delay leaves a write that is still inside its transaction time to commit before anyone reads.
export interface ChangeNotifier {
  // Marks that something changed.
  notify: () => void
  // Calls `listener(version)` after each delivery; returns the unsubscribe function.
  subscribe: (listener: (version: number) => void) => () => void
  readonly version: number
  readonly listenerCount: number
}

export const createChangeNotifier = (settleMs: number): ChangeNotifier => {
  const listeners = new Set<(version: number) => void>()
  let version = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const deliver = () => {
    timer = null
    version += 1
    for (const listener of [...listeners]) {
      try {
        listener(version)
      }
      catch { /* one broken listener must not silence the rest */ }
    }
  }

  return {
    notify: () => {
      // Nobody listening: nothing to coalesce, and no timer to keep alive.
      if (listeners.size === 0 || timer) {
        return
      }
      timer = setTimeout(deliver, settleMs)
      timer.unref?.()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer) {
          clearTimeout(timer)
          timer = null
        }
      }
    },
    get version() { return version },
    get listenerCount() { return listeners.size },
  }
}
