import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCachedPool,
  getPoolCacheKey,
  removeFromPool,
  scoreTrack,
  setCachedPool,
  sweepExpiredPools,
  weightedRandomPick,
} from '../../../server/utils/explore'
import type { CachedPool, ExploreParams, TrackCandidate } from '../../../types/player'

const track = (overrides: Partial<TrackCandidate> = {}): TrackCandidate => ({
  id: 't1',
  title: 'Track',
  artist: 'Artist',
  album: 'Album',
  duration: 200,
  year: 2000,
  genre: null,
  playCount: 0,
  lastPlayedAt: null,
  metadata: null,
  localReleaseId: null,
  localRelease: null,
  ...overrides,
})

const params = (overrides: Partial<ExploreParams> = {}): ExploreParams => ({
  energy: 5, era: 5, familiarity: 5, sound: 5, ...overrides,
})

describe('scoreTrack', () => {
  it('returns a finite score for a bare track with no metadata/genre', () => {
    const score = scoreTrack(track(), params())
    expect(Number.isFinite(score)).toBe(true)
  })

  it('scores a track with BPM squarely inside the energy slider range higher than one far outside', () => {
    // slider 7 "Energetic" wants bpm 120-160
    const inRange = scoreTrack(track({ metadata: { BPM: 140 } }), params({ energy: 7 }))
    const farOutside = scoreTrack(track({ metadata: { BPM: 60 } }), params({ energy: 7 }))
    expect(inRange).toBeGreaterThan(farOutside)
  })

  it('scores a track from the target era higher than one far outside it', () => {
    const inEra = scoreTrack(track({ year: 1975 }), params({ era: 1 })) // 1970s slider
    const outEra = scoreTrack(track({ year: 2020 }), params({ era: 1 }))
    expect(inEra).toBeGreaterThan(outEra)
  })

  it('treats a null year as neutral (0.5) for era scoring, not zero', () => {
    const withYear = scoreTrack(track({ year: 2020 }), params({ era: 0 }))
    const noYear = scoreTrack(track({ year: null }), params({ era: 0 }))
    expect(noYear).toBeGreaterThan(withYear)
  })

  it('familiarity slider 9 (uncharted) scores a played track as 0 for that dimension', () => {
    const played = scoreTrack(track({ playCount: 50 }), params({ familiarity: 9 }))
    const unplayed = scoreTrack(track({ playCount: 0 }), params({ familiarity: 9 }))
    expect(unplayed).toBeGreaterThan(played)
  })

  it('falls back to genre energy map when no BPM/mood metadata is present', () => {
    const highEnergyGenre = scoreTrack(track({ genre: 'gabber' }), params({ energy: 9 }))
    const lowEnergyGenre = scoreTrack(track({ genre: 'ambient' }), params({ energy: 9 }))
    expect(highEnergyGenre).toBeGreaterThan(lowEnergyGenre)
  })

  it('uses MOOD_ACOUSTIC/MOOD_ELECTRONIC when present for sound scoring', () => {
    const acoustic = scoreTrack(track({ metadata: { MOOD_ACOUSTIC: 90, MOOD_ELECTRONIC: 5 } }), params({ sound: 0 }))
    const electronic = scoreTrack(track({ metadata: { MOOD_ACOUSTIC: 5, MOOD_ELECTRONIC: 90 } }), params({ sound: 0 }))
    expect(acoustic).toBeGreaterThan(electronic)
  })
})

describe('getPoolCacheKey', () => {
  it('encodes all four slider values', () => {
    expect(getPoolCacheKey(params({ energy: 1, era: 2, familiarity: 3, sound: 4 }))).toBe('1-2-3-4')
  })
})

describe('candidate pool cache', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns null for a missing key', () => {
    expect(getCachedPool('missing-key', [])).toBeNull()
  })

  it('stores and retrieves candidates', () => {
    const key = 'k1'
    setCachedPool(key, [track({ id: 'a' }), track({ id: 'b' })])
    const result = getCachedPool(key, [])
    expect(result?.map(t => t.id)).toEqual(['a', 'b'])
  })

  it('filters out excluded ids', () => {
    const key = 'k2'
    setCachedPool(key, [track({ id: 'a' }), track({ id: 'b' })])
    const result = getCachedPool(key, ['a'])
    expect(result?.map(t => t.id)).toEqual(['b'])
  })

  it('expires entries older than the TTL', () => {
    const key = 'k3'
    setCachedPool(key, [track({ id: 'a' })])
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(getCachedPool(key, [])).toBeNull()
  })

  it('evicts the key once every candidate is excluded', () => {
    const key = 'k4'
    setCachedPool(key, [track({ id: 'a' })])
    expect(getCachedPool(key, ['a'])).toBeNull()
    // Setting again should not see stale eviction state leak.
    setCachedPool(key, [track({ id: 'b' })])
    expect(getCachedPool(key, [])?.map(t => t.id)).toEqual(['b'])
  })

  it('removeFromPool drops a single track without touching others', () => {
    const key = 'k5'
    setCachedPool(key, [track({ id: 'a' }), track({ id: 'b' })])
    removeFromPool(key, 'a')
    expect(getCachedPool(key, [])?.map(t => t.id)).toEqual(['b'])
  })
})

describe('sweepExpiredPools', () => {
  const entry = (createdAt: number): CachedPool => ({ candidates: [], createdAt })

  it('deletes only entries older than the TTL, leaving fresh ones untouched', () => {
    const cache = new Map<string, CachedPool>([
      ['stale', entry(0)],
      ['fresh', entry(9000)],
    ])
    sweepExpiredPools(cache, 10000, 5000)
    expect([...cache.keys()]).toEqual(['fresh'])
  })

  it('is a no-op when nothing has expired', () => {
    const cache = new Map<string, CachedPool>([['a', entry(9000)], ['b', entry(9500)]])
    sweepExpiredPools(cache, 10000, 5000)
    expect(cache.size).toBe(2)
  })
})

describe('weightedRandomPick', () => {
  it('returns null for an empty list', () => {
    expect(weightedRandomPick([])).toBeNull()
  })

  it('returns the only candidate when there is one', () => {
    const only = { track: track(), score: 0.5 }
    expect(weightedRandomPick([only])).toBe(only)
  })

  it('strongly favors the highest-scoring candidate under low temperature', () => {
    const low = { track: track({ id: 'low' }), score: 0.01 }
    const high = { track: track({ id: 'high' }), score: 0.99 }
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const pick = weightedRandomPick([low, high])
    expect(pick?.track.id).toBe('high')
    vi.restoreAllMocks()
  })
})
