import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAbortLike, TimeoutError, withDeadline } from '../../../server/utils/timeout'

describe('withDeadline', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns the result of work that finishes in time, and clears its timer', async () => {
    const result = await withDeadline(async () => 'done', 1000)
    expect(result).toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates the work\'s own error untouched', async () => {
    await expect(withDeadline(async () => { throw new Error('boom') }, 1000)).rejects.toThrow('boom')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts the work on timeout and reports TimeoutError only AFTER the work has actually stopped', async () => {
    const order: string[] = []
    const work = (signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        // Winding down takes a moment - the caller must not clean up before this finishes.
        setTimeout(() => { order.push('work stopped'); reject(signal.reason) }, 500)
      })
    })

    const pending = withDeadline(work, 1000, { label: 'relocate' }).catch((e) => {
      order.push('caller notified')
      return e
    })
    await vi.advanceTimersByTimeAsync(1000) // deadline fires -> abort
    expect(order).toEqual([])
    await vi.advanceTimersByTimeAsync(500)  // work unwinds
    const error = await pending

    expect(order).toEqual(['work stopped', 'caller notified'])
    expect(error).toBeInstanceOf(TimeoutError)
    expect(error.message).toBe('relocate timed out after 1000ms')
  })

  it('stops waiting after graceMs for work that ignores the signal', async () => {
    const work = () => new Promise<string>(() => {}) // never settles
    const pending = withDeadline(work, 1000, { graceMs: 2000 }).catch(e => e)

    await vi.advanceTimersByTimeAsync(1000 + 2000)

    expect(await pending).toBeInstanceOf(TimeoutError)
  })

  it('hands the work a signal that is not aborted while it runs in time', async () => {
    let seen: AbortSignal | undefined
    await withDeadline(async (signal) => { seen = signal }, 1000)
    expect(seen!.aborted).toBe(false)
  })
})

describe('isAbortLike', () => {
  it('recognises timeout and abort errors, and nothing else', () => {
    expect(isAbortLike(new TimeoutError('x', 1))).toBe(true)
    expect(isAbortLike(Object.assign(new Error('a'), { name: 'AbortError' }))).toBe(true)
    expect(isAbortLike(Object.assign(new Error('a'), { code: 'ABORT_ERR' }))).toBe(true)
    expect(isAbortLike(new Error('other'))).toBe(false)
    expect(isAbortLike(null)).toBe(false)
  })
})
