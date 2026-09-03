// Pure hue-wheel maths for Chaos's colour morph: pick a random target hue, ease into it over a
// random duration, then pick the next target - never an instant A-to-B jump. No Vue, no WebGL, no
// state - the state machine itself lives in components/visualizer/Canvas.vue, which is what makes
// this unit-testable without a canvas.

/**
 * Signed shortest distance from `from` to `to` around a 0-1 hue wheel, in (-0.5, 0.5].
 *
 * Without this, lerping two hues directly can take the LONG way round the wheel (e.g. 0.05 to
 * 0.95 is a hue 0.1 turns away going through red, not 0.9 turns away through the rest of the
 * wheel) - exactly backwards from what "morph" should look like.
 */
export const hueDelta = (from: number, to: number): number => {
  const raw = (((to - from) % 1) + 1) % 1
  return raw > 0.5 ? raw - 1 : raw
}

/** Eased position between two hues along the shortest arc of the wheel. `t` is clamped to 0-1. */
export const lerpHue = (from: number, to: number, t: number): number => {
  const clamped = Math.min(1, Math.max(0, t))
  const eased = clamped * clamped * (3 - 2 * clamped)
  return (((from + hueDelta(from, to) * eased) % 1) + 1) % 1
}
