import { describe, expect, it } from 'vitest'
import { defaultSelection, formatDecadeDuration, normalize, radarRawValues, radarValues } from '../../helpers/decadeRadar'
import type { DecadeStats } from '../../types/labs'

const decade = (over: Partial<DecadeStats>): DecadeStats => ({
  decade: '1990s', releaseCount: 10, trackCount: 100, artistCount: 5, avgDuration: 200_000, avgBitrate: 320, totalPlayCount: 50, topGenres: [], ...over,
}) as DecadeStats

describe('normalize', () => {
  it('scales against the maximum and never divides by zero', () => {
    expect(normalize(5, 10)).toBe(50)
    expect(normalize(10, 10)).toBe(100)
    expect(normalize(5, 0)).toBe(0)
  })
})

describe('radarValues', () => {
  it('scales every axis against the strongest decade in the library', () => {
    const a = decade({ decade: '1990s', releaseCount: 10, trackCount: 100, totalPlayCount: 0 })
    const b = decade({ decade: '2000s', releaseCount: 20, trackCount: 50, totalPlayCount: 40 })
    expect(radarValues(a, [a, b])).toEqual([50, 100, 100, 100, 100, 0])
    expect(radarValues(b, [a, b])).toEqual([100, 50, 100, 100, 100, 100])
  })
})

describe('radarRawValues / formatDecadeDuration', () => {
  it('reports the raw numbers behind each axis', () => {
    expect(radarRawValues(decade({ avgDuration: 185_400, avgBitrate: 256 }))).toEqual([10, 100, 5, '185s', '256 kbps', 50])
  })

  it('formats milliseconds as m:ss', () => {
    expect(formatDecadeDuration(185_000)).toBe('3:05')
    expect(formatDecadeDuration(59_400)).toBe('0:59')
  })
})

describe('defaultSelection', () => {
  it('picks the biggest decades by releases', () => {
    const all = [decade({ decade: 'a', releaseCount: 1 }), decade({ decade: 'b', releaseCount: 9 }), decade({ decade: 'c', releaseCount: 5 }), decade({ decade: 'd', releaseCount: 7 })]
    expect(defaultSelection(all)).toEqual(['b', 'd', 'c'])
    expect(defaultSelection(all, 1)).toEqual(['b'])
  })

  it('does not reorder the input', () => {
    const all = [decade({ decade: 'a', releaseCount: 1 }), decade({ decade: 'b', releaseCount: 9 })]
    defaultSelection(all)
    expect(all.map(d => d.decade)).toEqual(['a', 'b'])
  })
})
