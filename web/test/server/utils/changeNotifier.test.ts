import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChangeNotifier } from '../../../server/utils/changeNotifier'

describe('createChangeNotifier', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers a change once the settle time has passed, not before', () => {
    const notifier = createChangeNotifier(250)
    const listener = vi.fn()
    notifier.subscribe(listener)

    notifier.notify()
    vi.advanceTimersByTime(249)
    expect(listener).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(listener).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('folds a burst of notifications into one delivery', () => {
    const notifier = createChangeNotifier(250)
    const listener = vi.fn()
    notifier.subscribe(listener)

    for (let i = 0; i < 50; i++) {
      notifier.notify()
      vi.advanceTimersByTime(4)
    }
    vi.advanceTimersByTime(1000)

    // 50 notifications over 200 ms: the first opened a 250 ms window, everything in it rode along.
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a change after a delivery starts a new window, with the next version', () => {
    const notifier = createChangeNotifier(100)
    const listener = vi.fn()
    notifier.subscribe(listener)

    notifier.notify()
    vi.advanceTimersByTime(100)
    notifier.notify()
    vi.advanceTimersByTime(100)

    expect(listener.mock.calls).toEqual([[1], [2]])
    expect(notifier.version).toBe(2)
  })

  it('does nothing, and keeps no timer, while nobody is listening', () => {
    const notifier = createChangeNotifier(100)
    notifier.notify()
    expect(vi.getTimerCount()).toBe(0)
    expect(notifier.version).toBe(0)
  })

  it('stops delivering to a listener that unsubscribed, and drops the timer with the last one', () => {
    const notifier = createChangeNotifier(100)
    const stays = vi.fn()
    const leaves = vi.fn()
    notifier.subscribe(stays)
    const unsubscribe = notifier.subscribe(leaves)

    unsubscribe()
    notifier.notify()
    vi.advanceTimersByTime(100)
    expect(leaves).not.toHaveBeenCalled()
    expect(stays).toHaveBeenCalledTimes(1)

    const last = createChangeNotifier(100)
    const stop = last.subscribe(vi.fn())
    last.notify()
    stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(last.listenerCount).toBe(0)
  })

  it('a listener that throws does not silence the others', () => {
    const notifier = createChangeNotifier(10)
    const after = vi.fn()
    notifier.subscribe(() => { throw new Error('boom') })
    notifier.subscribe(after)

    notifier.notify()
    vi.advanceTimersByTime(10)

    expect(after).toHaveBeenCalledTimes(1)
  })
})
