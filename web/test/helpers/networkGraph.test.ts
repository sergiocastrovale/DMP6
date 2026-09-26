import { describe, expect, it } from 'vitest'
import { centerStrength, chargeStrength, graphMetrics, labelFontSize, linkDistance, linkStrength } from '../../helpers/networkGraph'

describe('graphMetrics', () => {
  it('takes the largest link weight and node size', () => {
    expect(graphMetrics([{ trackCount: 4 }, { trackCount: 9 }], [{ sharedTracks: 3 }, { sharedTracks: 7 }])).toEqual({ maxShared: 7, maxTracks: 9 })
  })

  it('never returns less than 1, so a scale domain is valid for an empty or zero graph', () => {
    expect(graphMetrics([], [])).toEqual({ maxShared: 1, maxTracks: 1 })
    expect(graphMetrics([{ trackCount: 0 }], [{ sharedTracks: 0 }])).toEqual({ maxShared: 1, maxTracks: 1 })
  })
})

describe('forces', () => {
  it('a focused view spaces nodes further apart, and heavier links pull them closer', () => {
    expect(linkDistance(4, true)).toBe(70)
    expect(linkDistance(4, false)).toBe(50)
    expect(linkDistance(1, false)).toBeGreaterThan(linkDistance(9, false))
  })

  it('link strength scales with weight and is capped at 0.8', () => {
    expect(linkStrength(5, 10)).toBe(0.5)
    expect(linkStrength(10, 10)).toBe(0.8)
  })

  it('a focused view repels a little more and centres a little less', () => {
    expect(chargeStrength(true)).toBeLessThan(chargeStrength(false))
    expect(centerStrength(true)).toBeLessThan(centerStrength(false))
  })
})

describe('labelFontSize', () => {
  it('follows the radius within 7-10px, and the focus label is a fixed 12', () => {
    expect(labelFontSize(5, false)).toBe(7)
    expect(labelFontSize(24, false)).toBe(10)
    expect(labelFontSize(12, false)).toBeCloseTo(8.4)
    expect(labelFontSize(30, true)).toBe(12)
  })
})
