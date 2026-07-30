import { describe, expect, it } from 'vitest'
import { getScoreRange, scoreRanges } from '../../helpers/constants'

describe('getScoreRange', () => {
  it('picks the matching bucket for interior values', () => {
    expect(getScoreRange(10)).toBe(scoreRanges[0])
    expect(getScoreRange(35)).toBe(scoreRanges[1])
    expect(getScoreRange(55)).toBe(scoreRanges[2])
    expect(getScoreRange(75)).toBe(scoreRanges[3])
    expect(getScoreRange(95)).toBe(scoreRanges[4])
  })

  it('treats bucket boundaries as [min, max)', () => {
    expect(getScoreRange(0)).toBe(scoreRanges[0])
    expect(getScoreRange(20)).toBe(scoreRanges[1])
    expect(getScoreRange(40)).toBe(scoreRanges[2])
    expect(getScoreRange(60)).toBe(scoreRanges[3])
    expect(getScoreRange(80)).toBe(scoreRanges[4])
  })

  it('falls back to the last bucket at/above 100', () => {
    expect(getScoreRange(100)).toBe(scoreRanges.at(-1))
    expect(getScoreRange(1000)).toBe(scoreRanges.at(-1))
  })

  it('falls back to the last bucket for out-of-range negative values too (no bucket matches)', () => {
    expect(getScoreRange(-5)).toBe(scoreRanges.at(-1))
  })
})
