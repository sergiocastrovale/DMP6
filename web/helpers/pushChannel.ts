// A server-sent-event channel that only ever says "re-read". `onChange` runs for each `changed` event - held back while
// the tab is hidden and run once when it is visible again - and `connected` says whether the channel is live, so a caller
// can slow its own polling down while it is and fall back to it when it is not (no EventSource, a refused stream, a drop).
// The browser reconnects a dropped stream by itself; a refused one (403, 404) is closed for good.

export interface PushEventSource {
  onopen: (() => void) | null
  onerror: (() => void) | null
  readonly readyState: number
  addEventListener: (type: string, listener: () => void) => void
  close: () => void
}

export interface PushVisibilityDoc {
  readonly hidden: boolean
  addEventListener: (type: 'visibilitychange', listener: () => void) => void
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void
}

export interface PushChannelOptions {
  url: string
  onChange: () => void
  onConnectedChange?: (connected: boolean) => void
  // Injectable for tests; default to the browser's own (absent on the server).
  createSource?: (url: string) => PushEventSource | null
  doc?: PushVisibilityDoc
}

export interface PushChannel {
  open: () => void
  close: () => void
  readonly connected: boolean
}

const CLOSED = 2

const browserSource = (url: string): PushEventSource | null => typeof EventSource === 'undefined' ? null : new EventSource(url) as unknown as PushEventSource

export const createPushChannel = ({
  url,
  onChange,
  onConnectedChange,
  createSource = browserSource,
  doc = typeof document === 'undefined' ? undefined : document,
}: PushChannelOptions): PushChannel => {
  let source: PushEventSource | null = null
  let connected = false
  let dirty = false
  let opened = false

  const setConnected = (next: boolean) => {
    if (connected !== next) {
      connected = next
      onConnectedChange?.(next)
    }
  }

  const onVisible = () => {
    if (doc && !doc.hidden && dirty) {
      dirty = false
      onChange()
    }
  }

  const changed = () => {
    if (doc?.hidden) {
      dirty = true
      return
    }
    onChange()
  }

  const close = () => {
    source?.close()
    source = null
    dirty = false
    opened = false
    doc?.removeEventListener('visibilitychange', onVisible)
    setConnected(false)
  }

  const open = () => {
    if (source) {
      return
    }
    const next = createSource(url)
    if (!next) {
      return
    }
    source = next
    doc?.addEventListener('visibilitychange', onVisible)
    next.onopen = () => {
      setConnected(true)
      // Whatever changed while the stream was down was never announced. The first open needs no catch-up - the caller has
      // just read the state.
      if (opened) {
        changed()
      }
      opened = true
    }
    next.onerror = () => {
      setConnected(false)
      // A refused stream never reconnects; drop it so open() can try again later. A dropped one is retried by the browser.
      if (next.readyState === CLOSED) {
        close()
      }
    }
    next.addEventListener('changed', changed)
  }

  return {
    open,
    close,
    get connected() { return connected },
  }
}
