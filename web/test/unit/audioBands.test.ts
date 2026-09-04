import { describe, expect, it } from 'vitest'
import { isBeat, rms, smoothTowards, splitBands } from '../../helpers/audioBands'

// Frequency data shaped so each band's slice of the array is a different constant - lets the
// assertions name an expected value rather than just "bass > mid". The bounds are the floored
// index ranges the implementation itself derives from its 0.08 / 0.3 / 0.6 fractions over 128
// bins; writing them as fractions here instead re-rounds differently and straddles a bin.
const BINS = 128

const bandedFreq = (bass: number, mid: number, treble: number, rest = 0): Uint8Array => {
  const data = new Uint8Array(BINS)
  for (let i = 0; i < BINS; i++) {
    data[i] = i < 10 ? bass : i < 38 ? mid : i < 76 ? treble : rest
  }
  return data
}

describe('splitBands', () => {
  it('normalises each band to 0-1 from its own slice of the spectrum', () => {
    const bands = splitBands(bandedFreq(255, 128, 0))
    expect(bands.bass).toBeCloseTo(1, 2)
    expect(bands.mid).toBeCloseTo(128 / 255, 2)
    expect(bands.treble).toBe(0)
  })

  it('ignores the dead top of the spectrum, which would otherwise dilute treble to nothing', () => {
    // Everything above 60% of the bins is silence here; treble must still read full scale.
    expect(splitBands(bandedFreq(0, 0, 255, 0)).treble).toBeCloseTo(1, 2)
  })

  it('reports silence as zero across every band', () => {
    expect(splitBands(new Uint8Array(BINS))).toEqual({ bass: 0, mid: 0, treble: 0 })
  })
})

describe('rms', () => {
  it('reads byte time-domain silence (centred on 128) as zero', () => {
    expect(rms(new Uint8Array(64).fill(128))).toBe(0)
  })

  it('reads a full-scale square wave as 1', () => {
    const wave = new Uint8Array(64)
    for (let i = 0; i < wave.length; i++) {
      wave[i] = i % 2 === 0 ? 0 : 255
    }
    // 0 maps to -1 and 255 to +0.992, so the mean square lands a hair under 1.
    expect(rms(wave)).toBeCloseTo(1, 2)
  })

  it('is zero for an empty buffer rather than NaN', () => {
    expect(rms(new Uint8Array(0))).toBe(0)
  })
})

describe('smoothTowards', () => {
  it('rises faster than it falls - the asymmetry is what makes a beat land on time', () => {
    const risen = smoothTowards(0, 1, 0.5, 0.1)
    const fallen = smoothTowards(1, 0, 0.5, 0.1)
    expect(risen).toBeCloseTo(0.5, 5)
    expect(fallen).toBeCloseTo(0.9, 5)
    expect(1 - fallen).toBeLessThan(risen)
  })

  it('converges on the target when repeatedly applied', () => {
    let value = 0
    for (let i = 0; i < 50; i++) {
      value = smoothTowards(value, 1, 0.5, 0.1)
    }
    expect(value).toBeCloseTo(1, 5)
  })
})

describe('isBeat', () => {
  it('fires when the signal spikes well above its own rolling baseline', () => {
    expect(isBeat(0.6, 0.2, 1.5, 0.12)).toBe(true)
  })

  it('does not fire for the steady level a baseline has already caught up to', () => {
    expect(isBeat(0.2, 0.2, 1.5, 0.12)).toBe(false)
  })

  it('does not fire right at the ratio threshold - it must clear it, not just meet it', () => {
    expect(isBeat(0.3, 0.2, 1.5, 0.12)).toBe(false)
  })

  it('ignores a spike that fails the absolute floor, even at a huge ratio over a near-zero baseline', () => {
    expect(isBeat(0.05, 0.001, 1.5, 0.12)).toBe(false)
  })

  it('requires both the ratio and the floor, not either alone', () => {
    // Clears the floor, not the ratio.
    expect(isBeat(0.15, 0.2, 1.5, 0.12)).toBe(false)
    // Clears the ratio, not the floor.
    expect(isBeat(0.1, 0.05, 1.5, 0.12)).toBe(false)
  })
})
