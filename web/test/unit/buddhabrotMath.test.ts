import { describe, expect, it } from 'vitest'
import {
  SEED_MAX_ITER,
  SEED_MIN_ESCAPE,
  accumulationSize,
  buildStateUvGrid,
  estimateNormalisation,
  generateSeedPool,
  halfLifeToDecayFactor,
  inMainCardioid,
  inPeriod2Bulb,
  logTone,
  projectionScale,
  quantizeStateValue,
  stateLevel,
} from '../../helpers/visualizer/buddhabrotMath'
import { cardioidPoint, mandelbrotEscape } from '../../helpers/visualizer/juliaPath'

describe('inMainCardioid / inPeriod2Bulb', () => {
  it('accepts points pulled slightly inside the cardioid boundary', () => {
    const [bx, by] = cardioidPoint(1.7)
    expect(inMainCardioid(bx * 0.95, by * 0.95)).toBe(true)
  })

  it('rejects points far outside the set on both tests', () => {
    expect(inMainCardioid(2, 2)).toBe(false)
    expect(inPeriod2Bulb(2, 2)).toBe(false)
    expect(inMainCardioid(-2, 0)).toBe(false)
    expect(inPeriod2Bulb(-2, 0)).toBe(false)
  })

  it('accepts the period-2 bulb centre (c = -1)', () => {
    expect(inPeriod2Bulb(-1, 0)).toBe(true)
  })

  // The invariant that actually matters: this closed-form filter must never wrongly claim a
  // provably-escaping point is interior, since a false positive would make the reseed logic skip
  // iterating a sample that should have been iterated. A bug here can only waste GPU cycles (see
  // the source comment); this test is what guarantees it can never corrupt the image instead.
  it('never claims interior for a point that provably escapes', () => {
    const probes: Array<[number, number]> = []
    for (let i = 0; i < 200; i++) {
      probes.push([Math.random() * 3 - 2, Math.random() * 3 - 1.5])
    }
    for (const [cx, cy] of probes) {
      if (inMainCardioid(cx, cy) || inPeriod2Bulb(cx, cy)) {
        expect(mandelbrotEscape(cx, cy, 300)).toBe(300)
      }
    }
  })
})

describe('halfLifeToDecayFactor', () => {
  it('is strictly between 0 and 1 for positive inputs', () => {
    const k = halfLifeToDecayFactor(20, 60)
    expect(k).toBeGreaterThan(0)
    expect(k).toBeLessThan(1)
  })

  it('halves a value after exactly one half-life worth of frames', () => {
    const halfLifeSeconds = 20
    const fps = 60
    const k = halfLifeToDecayFactor(halfLifeSeconds, fps)
    expect(k ** (halfLifeSeconds * fps)).toBeCloseTo(0.5, 6)
  })

  it('decays slower (k closer to 1) as the half-life grows', () => {
    const short = halfLifeToDecayFactor(10, 60)
    const long = halfLifeToDecayFactor(30, 60)
    expect(long).toBeGreaterThan(short)
  })

  it('is framerate-independent when expressed per second', () => {
    const halfLifeSeconds = 15
    const k30 = halfLifeToDecayFactor(halfLifeSeconds, 30)
    const k60 = halfLifeToDecayFactor(halfLifeSeconds, 60)
    expect(k30 ** 30).toBeCloseTo(k60 ** 60, 6)
  })
})

describe('accumulationSize', () => {
  it('returns the canvas size unchanged when already under the cap', () => {
    expect(accumulationSize(800, 450, 960)).toEqual([800, 450])
  })

  it('preserves aspect ratio when capping a wide canvas', () => {
    const [w, h] = accumulationSize(3840, 2160, 960)
    expect(w).toBe(960)
    expect(h / w).toBeCloseTo(2160 / 3840, 2)
  })

  it('preserves aspect ratio when capping a tall canvas', () => {
    const [w, h] = accumulationSize(1080, 1920, 960)
    expect(h).toBe(960)
    expect(w / h).toBeCloseTo(1080 / 1920, 2)
  })

  it('never returns a zero dimension', () => {
    const [w, h] = accumulationSize(1, 1, 960)
    expect(w).toBeGreaterThan(0)
    expect(h).toBeGreaterThan(0)
  })
})

describe('quantizeStateValue', () => {
  it('is idempotent - a quantised value stays put through a second pass', () => {
    for (const v of [-3.9, -1.25, -0.0001, 0, 0.3333, 1.7, 3.9]) {
      const once = quantizeStateValue(v)
      expect(quantizeStateValue(once)).toBeCloseTo(once, 12)
    }
  })

  it('lands within one grid step of the input', () => {
    const step = 8 / 65535
    for (let i = 0; i < 200; i++) {
      const v = Math.random() * 6 - 3
      expect(Math.abs(quantizeStateValue(v) - v)).toBeLessThanOrEqual(step)
    }
  })

  it('clamps outside the encodable range instead of wrapping', () => {
    expect(quantizeStateValue(-99)).toBeCloseTo(-4, 6)
    expect(quantizeStateValue(99)).toBeCloseTo(4, 6)
  })

  // Seeds are verified as float64, stored in a Float32Array, and then re-derived into a 16-bit
  // level by the upload path. If that round-trip can shift the level by even one step, the GPU
  // iterates a c one grid step from the one that was proven to escape - which near the boundary is
  // easily the difference between an escaping orbit and an interior one.
  it('survives the Float32Array round-trip with its level intact', () => {
    for (let i = 0; i < 500; i++) {
      const quantised = quantizeStateValue(Math.random() * 6 - 3)
      const stored = new Float32Array([quantised])[0]!
      expect(stateLevel(stored)).toBe(stateLevel(quantised))
    }
  })
})

describe('generateSeedPool', () => {
  const region = { cx: -0.5, cy: 0, radius: 1.45 }

  // THE invariant of the whole preset. The GPU plots every live orbit's points as it iterates,
  // which is only the canonical Buddhabrot if every one of those orbits provably escapes - an
  // interior orbit deposits density exactly where the image must stay black. If this test fails,
  // the render fills in and turns back into an opaque cloud.
  it('only ever returns constants that escape within SEED_MAX_ITER', () => {
    const pool = generateSeedPool(120, region)
    expect(pool.length).toBeGreaterThan(0)
    for (let i = 0; i < pool.length; i += 2) {
      const escape = mandelbrotEscape(pool[i]!, pool[i + 1]!, SEED_MAX_ITER)
      expect(escape).toBeLessThan(SEED_MAX_ITER)
      expect(escape).toBeGreaterThanOrEqual(SEED_MIN_ESCAPE)
    }
  })

  // Seeds reach the GPU through a 16-bit fixed-point encoding, and near the boundary a 1e-4 nudge
  // can move an escaping c inside the set - so verification has to happen on the ALREADY-quantised
  // value, or the guarantee above doesn't survive the trip.
  it('returns values already snapped to the GPU encoding grid', () => {
    const pool = generateSeedPool(60, region)
    for (const v of pool) {
      expect(quantizeStateValue(v)).toBeCloseTo(v, 12)
    }
  })

  it('stays inside the requested region', () => {
    const pool = generateSeedPool(80, region)
    for (let i = 0; i < pool.length; i += 2) {
      expect(Math.abs(pool[i]! - region.cx)).toBeLessThanOrEqual(region.radius + 1e-4)
      expect(Math.abs(pool[i + 1]! - region.cy)).toBeLessThanOrEqual(region.radius + 1e-4)
    }
  })

  it('writes two floats per accepted seed and never exceeds the requested count', () => {
    const pool = generateSeedPool(32, region)
    expect(pool.length % 2).toBe(0)
    expect(pool.length).toBeLessThanOrEqual(64)
  })

  // A region sitting entirely inside the set can never yield a seed; it must give up rather than
  // spin forever inside a frame.
  it('terminates and returns nothing for a region wholly inside the set', () => {
    const pool = generateSeedPool(8, { cx: -0.15, cy: 0, radius: 0.02 })
    expect(pool.length).toBe(0)
  })
})

describe('projectionScale', () => {
  it('applies the same scale to both axes on a square canvas', () => {
    const [sx, sy] = projectionScale(800, 800, 1.45)
    expect(sx).toBeCloseTo(sy, 10)
  })

  // The bug this exists to prevent: one shared divisor stretched the plane by the canvas aspect,
  // which smeared the silhouette unrecognisably on anything but a square canvas.
  it('shows proportionally more of the plane along the longer edge, not a stretched copy', () => {
    const viewScale = 1.45
    const [sx, sy] = projectionScale(2400, 1000, viewScale)
    // A unit step in the plane must cover the same number of PIXELS on both axes.
    expect(sx * 2400).toBeCloseTo(sy * 1000, 6)
    // ...and the short edge is the one that frames ±viewScale exactly.
    expect(1 / sy).toBeCloseTo(viewScale, 10)
  })

  it('frames the short edge for a tall canvas too', () => {
    const viewScale = 1.45
    const [sx, sy] = projectionScale(1000, 2400, viewScale)
    expect(sx * 1000).toBeCloseTo(sy * 2400, 6)
    expect(1 / sx).toBeCloseTo(viewScale, 10)
  })
})

describe('estimateNormalisation', () => {
  it('grows with elapsed frames when integrating monotonically', () => {
    const early = estimateNormalisation(60, 1000, 10000, 1, 1, 90)
    const later = estimateNormalisation(600, 1000, 10000, 1, 1, 90)
    expect(later).toBeGreaterThan(early)
    expect(later / early).toBeCloseTo(10, 6)
  })

  it('ignores elapsed frames when a decay factor pins the steady state', () => {
    const early = estimateNormalisation(60, 1000, 10000, 1, 0.99, 90)
    const later = estimateNormalisation(6000, 1000, 10000, 1, 0.99, 90)
    expect(later).toBeCloseTo(early, 10)
  })

  it('is always positive, even at frame zero', () => {
    expect(estimateNormalisation(0, 0, 0, 0, 1, 90)).toBeGreaterThan(0)
  })
})

describe('logTone', () => {
  it('maps zero density to zero and the normalisation point to one', () => {
    expect(logTone(0, 5, 400)).toBe(0)
    expect(logTone(5, 5, 400)).toBeCloseTo(1, 10)
  })

  it('is monotonic in density and stays within 0-1', () => {
    let previous = -1
    for (let i = 0; i <= 40; i++) {
      const value = logTone((i / 20) * 5, 5, 400)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      previous = value
    }
  })

  // The whole point of a log curve here: a linear exposure leaves the faint filaments that carry
  // the detail at effectively zero, which is what made the 8-bit linear version read as two flat
  // bands. A hundredth of the peak density must still be clearly visible.
  it('lifts faint density far above where a linear mapping would leave it', () => {
    const faint = logTone(0.05, 5, 400)
    expect(faint).toBeGreaterThan(0.05 / 5 * 10)
    expect(faint).toBeLessThan(1)
  })
})

describe('buildStateUvGrid', () => {
  it('produces exactly two floats per texel', () => {
    expect(buildStateUvGrid(4, 3).length).toBe(4 * 3 * 2)
  })

  it('centres the first and last texel within 0-1', () => {
    const grid = buildStateUvGrid(4, 2)
    expect(grid[0]).toBeCloseTo(0.125, 5) // (0 + 0.5) / 4
    expect(grid[1]).toBeCloseTo(0.25, 5) // (0 + 0.5) / 2
    const lastIndex = grid.length - 2
    expect(grid[lastIndex]).toBeCloseTo(0.875, 5) // (3 + 0.5) / 4
    expect(grid[lastIndex + 1]).toBeCloseTo(0.75, 5) // (1 + 0.5) / 2
  })

  it('every coordinate stays strictly inside 0-1', () => {
    const grid = buildStateUvGrid(5, 5)
    for (const v of grid) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    }
  })
})
