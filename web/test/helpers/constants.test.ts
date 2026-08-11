import { describe, expect, it } from 'vitest'
import { getScoreRange, scanActions, scoreRanges, visibleScanActions } from '../../helpers/constants'

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

describe('visibleScanActions', () => {
  it('drops artist-only actions from the global surface', () => {
    const ids = visibleScanActions('both', true).map(s => s.id)
    expect(ids).toEqual(['check', 'full', 'inspect', 'index', 'sync'])
  })

  it('keeps every action on the artist surface', () => {
    expect(visibleScanActions('artist', true)).toHaveLength(scanActions.length)
  })

  it('hides destructive actions from non-admins on both surfaces', () => {
    expect(visibleScanActions('both', false).map(s => s.id)).toEqual(['check', 'inspect', 'index', 'sync'])
    expect(visibleScanActions('artist', false).map(s => s.id)).not.toContain('full')
  })

  it('marks only the full re-scan as admin-only', () => {
    expect(scanActions.filter(s => s.admin).map(s => s.id)).toEqual(['full'])
  })
})
