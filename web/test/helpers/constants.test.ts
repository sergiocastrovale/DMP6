import { describe, expect, it } from 'vitest'
import { artistScanActions, getScoreRange, scanActions, scoreRanges, visibleArtistScanActions, visibleScanActions } from '../../helpers/constants'

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
  it('lists the library-wide actions in order for an admin', () => {
    const ids = visibleScanActions(true).map(s => s.id)
    expect(ids).toEqual(['check', 'full', 'inspect', 'index', 'sync'])
  })

  it('hides destructive actions from non-admins', () => {
    expect(visibleScanActions(false).map(s => s.id)).toEqual(['check', 'inspect', 'index', 'sync'])
  })

  it('marks only the full re-scan as admin-only', () => {
    expect(scanActions.filter(s => s.admin).map(s => s.id)).toEqual(['full'])
  })
})

describe('visibleArtistScanActions', () => {
  it('offers the four artist intents to an admin', () => {
    expect(visibleArtistScanActions(true).map(s => s.id)).toEqual(['check', 'rebuild', 'reindex', 'resync'])
  })

  // Every rebuild deletes the artist first, so a non-admin is left with the additive scan alone.
  it('leaves a non-admin only the non-destructive scan', () => {
    expect(visibleArtistScanActions(false).map(s => s.id)).toEqual(['check'])
  })

  it('gives every entry a distinct title and description', () => {
    const titles = new Set(artistScanActions.map(s => s.text))
    const subtexts = new Set(artistScanActions.map(s => s.subtext))
    expect(titles.size).toBe(artistScanActions.length)
    expect(subtexts.size).toBe(artistScanActions.length)
  })
})
