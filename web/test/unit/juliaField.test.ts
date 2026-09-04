import { describe, expect, it } from 'vitest'
import {
  buildProbeGrid,
  JULIA_RADIUS_MAX,
  JULIA_RADIUS_MIN,
  juliaFieldStats,
  juliaSmoothEscape,
  pickJuliaTarget,
} from '../../helpers/visualizer/juliaField'

describe('juliaSmoothEscape', () => {
  it('escapes almost immediately far from the origin with c = 0', () => {
    expect(juliaSmoothEscape(3, 3, 0, 0, 2, 60)).toBeLessThan(0.2)
  })

  it('never escapes at the exact fixed point z=c=0', () => {
    expect(juliaSmoothEscape(0, 0, 0, 0, 2, 60)).toBe(1)
  })

  it('returns a value in [0, 1]', () => {
    for (const [z0x, z0y] of [[0.5, 0.5], [1.5, -0.3], [-0.9, 0.9]] as const) {
      const m = juliaSmoothEscape(z0x, z0y, 0.3, 0.1, 3, 40)
      expect(m).toBeGreaterThanOrEqual(0)
      expect(m).toBeLessThanOrEqual(1)
    }
  })
})

describe('buildProbeGrid', () => {
  it('produces n*n points', () => {
    expect(buildProbeGrid(5, 1).length).toBe(25)
  })

  it('spans exactly [-span, span] at the corners', () => {
    const grid = buildProbeGrid(4, 2)
    const xs = grid.map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(-2, 10)
    expect(Math.max(...xs)).toBeCloseTo(2, 10)
  })
})

describe('juliaFieldStats', () => {
  const probes = buildProbeGrid(9, 0.35)

  it('reports a low highFraction for c well outside the connectivity locus', () => {
    // Radius 1.5 is well past JULIA_RADIUS_MAX - a deliberately "too far out" sanity check that
    // the metric can tell a clearly-safe candidate apart from a clearly-bad one.
    const stats = juliaFieldStats(1.5, 0, 2, 36, probes)
    expect(stats.highFraction).toBeLessThan(0.2)
  })

  it('reports a high highFraction for the known-bad small-|c| regime', () => {
    // This is the literal reported bug: small c (well inside where the old, unvalidated preset
    // picked from) reads as one flat colour across most of the frame.
    const stats = juliaFieldStats(0.05, 0.05, 2, 36, probes)
    expect(stats.highFraction).toBeGreaterThan(0.5)
  })
})

describe('pickJuliaTarget', () => {
  it('always returns power within the requested range', () => {
    const target = pickJuliaTarget(2.2, 6.0, 16)
    expect(target.power).toBeGreaterThanOrEqual(2.2)
    expect(target.power).toBeLessThanOrEqual(6.0)
  })

  it('always returns c within the validated radius band', () => {
    const target = pickJuliaTarget(2.2, 6.0, 16)
    const radius = Math.hypot(target.cx, target.cy)
    expect(radius).toBeGreaterThanOrEqual(JULIA_RADIUS_MIN - 1e-9)
    expect(radius).toBeLessThanOrEqual(JULIA_RADIUS_MAX + 1e-9)
  })

  it('is deterministic given a deterministic random source', () => {
    let calls = 0
    const fixedRandom = () => {
      calls++
      // A short, fixed sequence - just needs to be reproducible across the two calls below.
      return [0.1, 0.6, 0.35, 0.9][calls % 4]!
    }
    const a = pickJuliaTarget(2.2, 6.0, 8, fixedRandom)
    calls = 0
    const b = pickJuliaTarget(2.2, 6.0, 8, fixedRandom)
    expect(a).toEqual(b)
  })

  it('never throws and always returns a finite target, even with an adversarial random source', () => {
    const target = pickJuliaTarget(2.2, 6.0, 8, () => 0)
    expect(Number.isFinite(target.power)).toBe(true)
    expect(Number.isFinite(target.cx)).toBe(true)
    expect(Number.isFinite(target.cy)).toBe(true)
  })
})
