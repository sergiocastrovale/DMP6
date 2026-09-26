import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPoller } from '../../helpers/poller'

const fakeDoc = () => {
  const listeners = new Set<() => void>()
  return {
    hidden: false,
    addEventListener: (_: 'visibilitychange', cb: () => void) => { listeners.add(cb) },
    removeEventListener: (_: 'visibilitychange', cb: () => void) => { listeners.delete(cb) },
    fireVisibility: () => { for (const cb of [...listeners]) {cb()} },
    listenerCount: () => listeners.size,
  }
}

describe('createPoller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs after each delay and re-reads the delay every round', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    let ms = 1000
    const poller = createPoller({ run, delay: () => ms, doc: fakeDoc() })
    poller.start()

    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)
    ms = 5000 // cadence follows state
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(3)
    poller.stop()
  })

  it('never overlaps: the next wait starts only after a slow run finishes', async () => {
    let release: () => void = () => {}
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const poller = createPoller({ run, delay: () => 1000, doc: fakeDoc() })
    poller.start()

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(1) // still in flight, nothing stacked behind it

    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('stops itself when delay() returns null, and can be started again', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    let ms: number | null = 1000
    const poller = createPoller({ run, delay: () => ms, doc: fakeDoc() })
    poller.start()
    await vi.advanceTimersByTimeAsync(1000) // run 1; the next wait (1000) is already scheduled
    ms = null
    await vi.advanceTimersByTimeAsync(1000) // run 2, after which delay() says stop
    expect(run).toHaveBeenCalledTimes(2)
    expect(poller.active).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(2)

    ms = 1000
    poller.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(3)
    poller.stop()
  })

  it('parks while the tab is hidden and runs immediately when it becomes visible', async () => {
    const doc = fakeDoc()
    const run = vi.fn().mockResolvedValue(undefined)
    const poller = createPoller({ run, delay: () => 1000, doc })
    poller.start()

    doc.hidden = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).not.toHaveBeenCalled()

    doc.hidden = false
    doc.fireVisibility()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('reschedule() applies a new delay without waiting out the old one', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    let ms = 15_000
    const poller = createPoller({ run, delay: () => ms, doc: fakeDoc() })
    poller.start()
    await vi.advanceTimersByTimeAsync(5000)

    ms = 2000
    poller.reschedule()
    await vi.advanceTimersByTimeAsync(2000)

    expect(run).toHaveBeenCalledTimes(1)
    poller.stop()
  })

  it('keeps polling after a run throws', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const poller = createPoller({ run, delay: () => 1000, doc: fakeDoc() })
    poller.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('stop() cancels the pending run and removes the visibility listener', async () => {
    const doc = fakeDoc()
    const run = vi.fn().mockResolvedValue(undefined)
    const poller = createPoller({ run, delay: () => 1000, doc })
    poller.start()
    expect(doc.listenerCount()).toBe(1)
    poller.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(run).not.toHaveBeenCalled()
    expect(doc.listenerCount()).toBe(0)
  })
})
