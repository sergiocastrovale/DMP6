import { describe, expect, it } from 'vitest'
import { oklchToHueDegrees, oklchToRgb, rgbToHueDegrees } from '../../helpers/oklch'
import { themes } from '../../helpers/constants'

describe('oklchToRgb', () => {
  it('round-trips the achromatic ends', () => {
    expect(oklchToRgb(1, 0, 0).map(c => Math.round(c * 255))).toEqual([255, 255, 255])
    expect(oklchToRgb(0, 0, 0).map(c => Math.round(c * 255))).toEqual([0, 0, 0])
  })

  it('resolves the default accent to the orange it renders as', () => {
    const [r, g, b] = oklchToRgb(0.78, 0.16, 75)
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    expect(Math.round(r * 255)).toBeGreaterThan(220)
  })

  it('clamps out-of-gamut requests into sRGB rather than emitting negatives', () => {
    for (const channel of oklchToRgb(0.6, 0.4, 140)) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
  })
})

describe('rgbToHueDegrees', () => {
  it('reads the primaries off the wheel', () => {
    expect(rgbToHueDegrees([1, 0, 0])).toBeCloseTo(0, 4)
    expect(rgbToHueDegrees([0, 1, 0])).toBeCloseTo(120, 4)
    expect(rgbToHueDegrees([0, 0, 1])).toBeCloseTo(240, 4)
  })

  it('returns 0 for grey rather than NaN', () => {
    expect(rgbToHueDegrees([0.5, 0.5, 0.5])).toBe(0)
  })
})

describe('oklchToHueDegrees', () => {
  // The bug this guards: the oklch hue was passed to the shader's HSV palette unconverted, so the
  // amber accent rendered green. The two spaces do not share an angle.
  it('differs from the oklch angle it was derived from', () => {
    const hue = oklchToHueDegrees(0.78, 0.16, 75)
    expect(hue).toBeGreaterThan(25)
    expect(hue).toBeLessThan(55)
  })

  it('keeps every accent theme in its own part of the wheel', () => {
    const hues = themes.map(t => oklchToHueDegrees(...t.oklch))
    expect(new Set(hues.map(Math.round)).size).toBe(themes.length)
    for (const hue of hues) {
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('places each accent where its name says it should be', () => {
    const hueOf = (id: string) => oklchToHueDegrees(...themes.find(t => t.id === id)!.oklch)
    expect(hueOf('amber')).toBeLessThan(60)
    expect(hueOf('green')).toBeGreaterThan(90)
    expect(hueOf('green')).toBeLessThan(180)
    expect(hueOf('cyan')).toBeGreaterThan(180)
    expect(hueOf('cyan')).toBeLessThan(250)
    expect(hueOf('violet')).toBeGreaterThan(250)
    expect(hueOf('violet')).toBeLessThan(320)
    expect(hueOf('rose')).toBeGreaterThan(320)
  })
})
