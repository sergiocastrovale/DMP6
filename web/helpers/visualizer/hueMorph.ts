// Pure A-to-B morph maths shared by every visualizer preset that eases toward a random target and
// then picks the next one - Chaos's hue, Fractal's Julia-path phase, Julia's power. No Vue, no
// WebGL, no state - the state machine itself lives in components/visualizer/Canvas.vue, which is
// what makes this unit-testable without a canvas.

/**
 * Smoothstep: 0 at t=0, 1 at t=1, zero derivative at both ends. `t` is clamped to 0-1 first, so a
 * morph that has run past its own duration holds at the target instead of overshooting.
 *
 * Shared by every A-to-B morph below rather than each re-deriving its own curve, so they all
 * accelerate/decelerate identically - the visual "family resemblance" between how Chaos's colour,
 * Fractal's shape and Julia's power each ease into their next random target.
 */
export const easeSmoothstep = (t: number): number => {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped * clamped * (3 - 2 * clamped)
}

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
export const lerpHue = (from: number, to: number, t: number): number =>
  (((from + hueDelta(from, to) * easeSmoothstep(t)) % 1) + 1) % 1

/**
 * Eased position between two plain (non-circular) values - e.g. Julia's drifting power, which has
 * no wheel to wrap around, unlike a hue or a path phase. `t` is clamped to 0-1 via easeSmoothstep.
 */
export const lerpEased = (from: number, to: number, t: number): number =>
  from + (to - from) * easeSmoothstep(t)
