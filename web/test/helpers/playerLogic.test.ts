import { describe, expect, it, vi } from 'vitest'
import {
  nextIndexWrap,
  pushCapped,
  QUEUE_PERSIST_CAP,
  shouldScrobble,
  shuffleArray,
  sliceForPersist,
  unshiftCapped,
} from '../../helpers/playerLogic'

describe('shuffleArray', () => {
  it('returns the same array reference (mutates in place)', () => {
    const arr = [1, 2, 3]
    expect(shuffleArray(arr)).toBe(arr)
  })

  it('produces a permutation of the input (same elements, same length)', () => {
    const input = [1, 2, 3, 4, 5]
    const shuffled = shuffleArray([...input])
    expect(shuffled).toHaveLength(input.length)
    expect([...shuffled].sort()).toEqual([...input].sort())
  })

  it('is a no-op for a single-element or empty array', () => {
    expect(shuffleArray([1])).toEqual([1])
    expect(shuffleArray([])).toEqual([])
  })

  it('with Math.random pinned to 0, produces the deterministic all-swap-to-front permutation', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    // Fisher-Yates with j always 0: each pass swaps the current tail element to index 0.
    expect(shuffleArray([1, 2, 3, 4])).toEqual([2, 3, 4, 1])
    vi.restoreAllMocks()
  })
})

describe('shouldScrobble', () => {
  it('never scrobbles under 30s duration, even if currentTime exceeds it', () => {
    expect(shouldScrobble({ duration: 20, currentTime: 25 })).toBe(false)
  })

  it('scrobbles once past 50% of a track >= 30s', () => {
    expect(shouldScrobble({ duration: 100, currentTime: 51 })).toBe(true)
    expect(shouldScrobble({ duration: 100, currentTime: 49 })).toBe(false)
  })

  it('scrobbles past the 240s absolute threshold even under 50%', () => {
    expect(shouldScrobble({ duration: 1000, currentTime: 241 })).toBe(true)
    expect(shouldScrobble({ duration: 1000, currentTime: 239 })).toBe(false)
  })

  it('boundary: exactly 30s duration is eligible', () => {
    expect(shouldScrobble({ duration: 30, currentTime: 16 })).toBe(true)
  })
})

describe('pushCapped (FIFO)', () => {
  it('pushes to the end', () => {
    const arr = [1, 2]
    pushCapped(arr, 3, 10)
    expect(arr).toEqual([1, 2, 3])
  })

  it('drops from the front once over cap', () => {
    const arr = [1, 2, 3]
    pushCapped(arr, 4, 3)
    expect(arr).toEqual([2, 3, 4])
  })

  it('never exceeds the cap across repeated pushes', () => {
    const arr: number[] = []
    for (let i = 0; i < 10; i++) {pushCapped(arr, i, 5)}
    expect(arr).toHaveLength(5)
    expect(arr).toEqual([5, 6, 7, 8, 9])
  })
})

describe('unshiftCapped (LIFO)', () => {
  it('unshifts to the front', () => {
    const arr = [1, 2]
    unshiftCapped(arr, 0, 10)
    expect(arr).toEqual([0, 1, 2])
  })

  it('drops from the back once over cap', () => {
    const arr = [1, 2, 3]
    unshiftCapped(arr, 0, 3)
    expect(arr).toEqual([0, 1, 2])
  })

  it('never exceeds the cap across repeated unshifts', () => {
    const arr: number[] = []
    for (let i = 0; i < 10; i++) {unshiftCapped(arr, i, 5)}
    expect(arr).toHaveLength(5)
    expect(arr).toEqual([9, 8, 7, 6, 5])
  })
})

describe('nextIndexWrap', () => {
  it('returns null for an empty queue', () => {
    expect(nextIndexWrap(0, -1)).toBeNull()
  })

  it('advances by one within bounds', () => {
    expect(nextIndexWrap(5, 1)).toBe(2)
  })

  it('wraps from the last index back to 0', () => {
    expect(nextIndexWrap(5, 4)).toBe(0)
  })

  it('treats currentIndex -1 (not found) as starting from the top', () => {
    expect(nextIndexWrap(5, -1)).toBe(0)
  })
})

describe('sliceForPersist', () => {
  it('returns the array unchanged when under the cap', () => {
    expect(sliceForPersist([1, 2, 3], 200)).toEqual([1, 2, 3])
  })

  it('keeps only the last `cap` entries', () => {
    const arr = Array.from({ length: 250 }, (_, i) => i)
    const sliced = sliceForPersist(arr, 200)
    expect(sliced).toHaveLength(200)
    expect(sliced[0]).toBe(50)
    expect(sliced.at(-1)).toBe(249)
  })

  it('defaults to QUEUE_PERSIST_CAP (200) when no cap is given', () => {
    const arr = Array.from({ length: 300 }, (_, i) => i)
    expect(sliceForPersist(arr)).toHaveLength(QUEUE_PERSIST_CAP)
  })
})
