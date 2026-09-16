import { describe, expect, it } from 'vitest'
import { clamp, shuffleInPlace } from '../../../../server/utils/subsonic/util'

describe('clamp', () => {
  it('clamps into [min, max]', () => {
    expect(clamp(5, 1, 10)).toBe(5)
    expect(clamp(-5, 1, 10)).toBe(1)
    expect(clamp(50, 1, 10)).toBe(10)
  })
})

describe('shuffleInPlace', () => {
  it('preserves the same elements (a permutation, not a resample)', () => {
    const arr = [1, 2, 3, 4, 5]
    const shuffled = shuffleInPlace([...arr])
    expect(shuffled.slice().sort()).toEqual(arr.slice().sort())
  })

  it('mutates and returns the same array reference', () => {
    const arr = [1, 2, 3]
    expect(shuffleInPlace(arr)).toBe(arr)
  })
})
