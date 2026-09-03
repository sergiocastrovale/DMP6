import { describe, expect, it } from 'vitest'
import { hueDelta, lerpHue } from '../../helpers/visualizer/hueMorph'

describe('hueDelta', () => {
  it('is zero for identical hues', () => {
    expect(hueDelta(0.3, 0.3)).toBe(0)
  })

  it('takes the short way, not the long way, around the wheel', () => {
    // 0.05 -> 0.95 is 0.1 the "wrap" way (through 0/1), not 0.9 straight across.
    expect(hueDelta(0.05, 0.95)).toBeCloseTo(-0.1, 10)
    expect(hueDelta(0.95, 0.05)).toBeCloseTo(0.1, 10)
  })

  it('matches a direct subtraction when the short way is already the direct way', () => {
    expect(hueDelta(0.2, 0.5)).toBeCloseTo(0.3, 10)
    expect(hueDelta(0.5, 0.2)).toBeCloseTo(-0.3, 10)
  })

  it('is well-defined at exactly half the wheel', () => {
    // Either direction is equally short at 0.5 turns - just must not be NaN/undefined either way.
    expect(Math.abs(hueDelta(0.0, 0.5))).toBeCloseTo(0.5, 10)
  })
})

describe('lerpHue', () => {
  it('starts at `from` and ends at `to`', () => {
    expect(lerpHue(0.1, 0.6, 0)).toBeCloseTo(0.1, 10)
    expect(lerpHue(0.1, 0.6, 1)).toBeCloseTo(0.6, 10)
  })

  it('clamps t outside 0-1 rather than overshooting the target', () => {
    expect(lerpHue(0.1, 0.6, -5)).toBeCloseTo(0.1, 10)
    expect(lerpHue(0.1, 0.6, 5)).toBeCloseTo(0.6, 10)
  })

  it('eases rather than moving linearly - the midpoint of time is not the midpoint of the arc', () => {
    // Smoothstep's derivative is 0 at t=0.25, so very little movement has happened yet - unlike a
    // linear lerp, which would already be a quarter of the way there.
    const quarter = lerpHue(0.0, 0.4, 0.25)
    expect(quarter).toBeLessThan(0.1)
  })

  it('travels the short way around the wheel, never jumping the long way', () => {
    const value = lerpHue(0.02, 0.98, 0.5)
    // The short arc from 0.02 to 0.98 passes through 0/1, landing near there at the midpoint -
    // not near 0.5, which is where a naive (non-wheel-aware) lerp would put it.
    const distanceFromWrap = Math.min(value, 1 - value)
    expect(distanceFromWrap).toBeLessThan(0.05)
  })

  it('stays within [0, 1) for values right at the wrap', () => {
    const value = lerpHue(0.99, 0.01, 0.5)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(1)
  })
})
