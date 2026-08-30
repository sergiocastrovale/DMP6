import { describe, expect, it } from 'vitest'
import { artistScanActions, getScoreRange, getStatus, scanActions, scoreRanges, statuses, visibleArtistScanActions, visibleScanActions } from '../../helpers/constants'
import { toneBg, toneFill, toneText } from '../../helpers/ui'
import type { ReleaseStatus } from '../../types/release'

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

// The full ReleaseStatus union - kept here as a literal list (not imported from anywhere the enum
// itself lives) so this test fails the moment the type grows a member the statuses[] map hasn't
// caught up with yet, rather than silently passing on whatever the map happens to contain.
const ALL_RELEASE_STATUSES: ReleaseStatus[] = ['COMPLETE', 'EXTRA_TRACKS', 'MISSING_TRACKS', 'INCOMPLETE', 'MISSING', 'UNKNOWN', 'UNMATCHED']

describe('statuses', () => {
  it('covers every ReleaseStatus exactly once', () => {
    expect(statuses.map(s => s.value).sort()).toEqual([...ALL_RELEASE_STATUSES].sort())
  })

  it('gives every entry a tone that resolves in all three tone maps', () => {
    for (const status of statuses) {
      expect(toneText[status.tone]).toEqual(expect.any(String))
      expect(toneBg[status.tone]).toEqual(expect.any(String))
      expect(toneFill[status.tone]).toEqual(expect.any(String))
    }
  })

  it('gives every entry a distinct, ascending weight (worst-status rollups depend on this order)', () => {
    const weights = statuses.map(s => s.weight)
    expect(new Set(weights).size).toBe(statuses.length)
    expect(weights).toEqual([...weights].sort((a, b) => a - b))
  })

  it('never reuses "muted" for a status the release list should visually flag', () => {
    // UNKNOWN is a legitimate "nothing to report yet" state; every other status describes a
    // real mismatch and must not fade into the same low-emphasis tone.
    const flagged = statuses.filter(s => s.value !== 'UNKNOWN')
    expect(flagged.every(s => s.tone !== 'muted')).toBe(true)
  })
})

describe('getStatus', () => {
  it.each(ALL_RELEASE_STATUSES)('resolves %s to its statuses[] entry', (value) => {
    expect(getStatus(value)).toBe(statuses.find(s => s.value === value))
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
