// Pure maths between an AnalyserNode's byte arrays and the uniforms a visualizer shader wants.
// No Vue, no DOM, no WebGL - so it unit-tests without any of them (test/unit/audioBands.test.ts).

import type { AudioBands } from '~/types/visualizer'

// Fractions of the FFT bin range, not absolute indices, so these hold whatever VISUALIZER_FFT_SIZE
// is set to. The upper half of the spectrum is mostly empty air at 44.1kHz - treble stops at 60%
// rather than 100% so a quiet hi-hat isn't averaged away against 40 dead bins.
const BAND_SPLITS = { bass: [0, 0.08], mid: [0.08, 0.3], treble: [0.3, 0.6] } as const

const meanOfRange = (data: Uint8Array, from: number, to: number): number => {
  const start = Math.floor(from * data.length)
  const end = Math.max(start + 1, Math.floor(to * data.length))
  let total = 0
  for (let i = start; i < end; i++) {
    total += data[i] ?? 0
  }
  return total / (end - start) / 255
}

export const splitBands = (freq: Uint8Array): AudioBands => ({
  bass: meanOfRange(freq, BAND_SPLITS.bass[0], BAND_SPLITS.bass[1]),
  mid: meanOfRange(freq, BAND_SPLITS.mid[0], BAND_SPLITS.mid[1]),
  treble: meanOfRange(freq, BAND_SPLITS.treble[0], BAND_SPLITS.treble[1]),
})

// Byte time-domain data is unsigned with silence at 128, so every sample is re-centred before it
// is squared. Returns 0-1, where 1 is a full-scale square wave.
export const rms = (timeDomain: Uint8Array): number => {
  if (timeDomain.length === 0) {
    return 0
  }
  let total = 0
  for (let i = 0; i < timeDomain.length; i++) {
    const sample = ((timeDomain[i] ?? 128) - 128) / 128
    total += sample * sample
  }
  return Math.sqrt(total / timeDomain.length)
}

// Asymmetric smoothing: a rise is followed almost immediately, a fall is eased out. Symmetric
// smoothing is what makes a visualizer feel mushy - the kick lands before the shape reacts, and
// the shape is still shrinking when the next one hits. `attack`/`release` are per-frame lerp
// factors (0 = frozen, 1 = no smoothing).
export const smoothTowards = (prev: number, next: number, attack: number, release: number): number => {
  const factor = next > prev ? attack : release
  return prev + (next - prev) * factor
}

// A beat/onset is a transient relative to the recent average, not an absolute level - a quiet
// verse and a loud chorus both have kicks, at very different absolute volumes. `baseline` should
// be `raw` pushed through smoothTowards() with a much slower attack/release than the audio bands
// themselves (a rolling average, not an envelope follower), so a kick reads as a spike against its
// own recent history. `floor` guards against near-silence, where `raw` and `baseline` are both
// tiny and their ratio is noise, not signal.
export const isBeat = (raw: number, baseline: number, ratio: number, floor: number): boolean =>
  raw > floor && raw > baseline * ratio
