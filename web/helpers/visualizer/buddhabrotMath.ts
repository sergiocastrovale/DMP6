// Pure maths for the Buddhabrot preset (helpers/visualizer/buddhabrot.ts). No WebGL, no Vue - same
// split as juliaPath.ts/hueMorph.ts, which is what makes this unit-testable without a canvas.

import { mandelbrotEscape } from '~/helpers/visualizer/juliaPath'

/**
 * Closed-form test for whether `(cx, cy)` sits inside the Mandelbrot set's main cardioid -
 * O(1), no iteration. Used as a cheap CPU-verifiable / GPU-portable pre-filter before a Buddhabrot
 * reseed spends any iterations on a sample: roughly two-thirds of the complex plane's "obviously
 * interior" points can be rejected for free this way, before the GPU-side advance pass ever runs
 * z <- z² + c on them.
 *
 * A bug here can only ever WASTE GPU cycles (an incorrectly-accepted interior point gets skipped
 * pre-iteration, or an incorrectly-rejected one gets iterated for nothing) - it can never corrupt
 * the image, because the GPU-side advance pass has its own independent bailout and lifetime cap
 * regardless of what this filter decided. See the cross-check test below, which is the invariant
 * that actually matters.
 */
export const inMainCardioid = (cx: number, cy: number): boolean => {
  const q = (cx - 0.25) ** 2 + cy * cy
  return q * (q + (cx - 0.25)) < 0.25 * cy * cy
}

/** Same idea as {@link inMainCardioid}, for the period-2 bulb attached at c = -1. */
export const inPeriod2Bulb = (cx: number, cy: number): boolean =>
  (cx + 1) ** 2 + cy * cy < 0.0625

/**
 * Convert a half-life in seconds to the per-frame multiplicative decay factor `k` such that
 * repeatedly multiplying by `k` at `fps` frames/second halves a value every `halfLifeSeconds`.
 *
 * This is what keeps the Buddhabrot accumulation buffer from saturating at 255 (nothing ever
 * decays) or freezing into a static image (decaying too fast to keep any density around) - the
 * splat pass adds density every frame, a `blendFunc(ZERO, SRC_COLOR)` fade pass every frame
 * multiplies the whole buffer by this `k`, and the two together settle at a steady-state density
 * per pixel rather than either extreme.
 */
export const halfLifeToDecayFactor = (halfLifeSeconds: number, fps: number): number =>
  0.5 ** (1 / (halfLifeSeconds * fps))

/**
 * The accumulation texture's pixel dimensions for a `width`x`height` canvas, aspect-preserved and
 * capped at `cap` on the long edge.
 *
 * Deliberately NOT 1:1 with the canvas: a fixed per-frame sample budget spread over 4x the texels
 * (a 4K canvas vs. a capped ~960px one) reads as noisy and sparse rather than dense - the present
 * pass upscales this texture with linear filtering, which is a quality choice, not just a perf one.
 */
export const accumulationSize = (width: number, height: number, cap: number): [number, number] => {
  const longEdge = Math.max(width, height, 1)
  const scale = Math.min(1, cap / longEdge)
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

/**
 * One (u, v) pair per texel of a `width`x`height` texture, texel-centre-sampled - so a `NEAREST`-
 * filtered lookup in the splat pass's vertex shader lands exactly on one texel, never blended
 * between two (blending two byte-packed orbit states together would produce a meaningless value,
 * not an average of anything real). Row-major: this is the one-vertex-per-state-texel attribute
 * buffer helpers/visualizer/buddhabrot.ts's splat pass draws as `gl.POINTS`.
 */
// The escape-count window a seed must land in to enter the live pool.
//
// A Buddhabrot is a histogram of ESCAPING orbits' trajectories, and the two ends of the escape-count
// range contribute almost nothing to it: a c that escapes in under ~40 steps is far outside the set
// and draws a short, featureless arc, while one that never escapes within SEED_MAX_ITER is interior
// (or so close to it that the difference doesn't render) and must contribute NOTHING at all - an
// interior orbit deposits density exactly where the image has to stay black, which is what turns a
// Buddhabrot into an opaque cloud. Everything between is the real signal: high counts hug the
// boundary and draw the long filigree the reference renders are made of.
export const SEED_MAX_ITER = 2000
export const SEED_MIN_ESCAPE = 40
// How many verified seeds the pool holds - one texel each in the width x 1 pool texture the GPU
// reseeds from. Lives here rather than in buddhabrot.ts so the CPU side that fills the pool
// (components/visualizer/Canvas.vue) doesn't have to import the WebGL module for a sizing constant.
export const SEED_POOL_CAPACITY = 4096

// Fixed-point grid the GPU state textures quantise to - the exact JS mirror of encode16()/decode16()
// in helpers/visualizer/buddhabrot.ts's RGBA8 fallback path (16 bits across two 8-bit channels over
// [-4, 4]).
const STATE_RANGE = 4
const STATE_LEVELS = 65535

/**
 * Snap `v` to the exact value the GPU's 16-bit fixed-point state encoding will read back.
 *
 * Seeds are verified on the CPU and then handed to the GPU through that encoding, so they must be
 * verified as the value the GPU will ACTUALLY iterate, not the one the CPU happened to draw. Near
 * the Mandelbrot boundary the escape count is violently sensitive to c - a 1e-4 nudge can move a
 * verified-escaping seed inside the set - so quantising after verification would silently let the
 * interior contamination this whole scheme exists to prevent back in through the encoding.
 */
export const stateLevel = (v: number): number => {
  const clamped = Math.min(1, Math.max(0, (v + STATE_RANGE) / (STATE_RANGE * 2)))
  // Round, not floor, and matched by the `+ 0.5` in the GLSL encode16(). Rounding is what makes the
  // encoding a true round-trip: the pool is a Float32Array, so a level's own value comes back with
  // up to ~0.004 of a level of float32 error, and flooring that lands one step low about half the
  // time - which would hand the GPU a c one grid step from the one that was actually verified.
  return Math.round(clamped * STATE_LEVELS)
}

export const quantizeStateValue = (v: number): number =>
  // Math.fround because the value's destination is a Float32Array: this returns the number the GPU
  // will really see, so verification happens against that exact value and not a float64 near-miss.
  Math.fround((stateLevel(v) / STATE_LEVELS) * (STATE_RANGE * 2) - STATE_RANGE)

export interface SeedRegion { cx: number, cy: number, radius: number }

/**
 * A pool of Mandelbrot constants that are all **proven to escape** within {@link SEED_MAX_ITER},
 * with an escape count of at least {@link SEED_MIN_ESCAPE}, written as `[cx, cy]` pairs.
 *
 * This is the one guarantee the whole preset rests on. Because every live sample's c provably
 * escapes, the GPU can plot each orbit's points AS IT ITERATES and still be drawing exactly the
 * canonical Buddhabrot - the "test the orbit first, then replay it and plot" two-pass algorithm -
 * without ever running the test pass on the GPU. Testing on the GPU instead was the original design
 * and is what failed: it could only afford ~50 iterations per candidate, which does not remotely
 * resolve a near-boundary point, so interior orbits were admitted constantly and filled in the void.
 *
 * `inMainCardioid`/`inPeriod2Bulb` pre-reject the two largest interior components for free, which
 * is what keeps this cheap enough to run per-frame: without it, a quarter of all candidates would
 * cost the full SEED_MAX_ITER iterations to reject.
 */
export const generateSeedPool = (
  count: number,
  region: SeedRegion,
  random: () => number = Math.random,
  out: Float32Array = new Float32Array(count * 2),
): Float32Array => {
  // Bounded, not "loop until we have `count`": acceptance is only a few percent, and a pathological
  // region (one sitting entirely inside the set) must not spin forever inside a frame.
  const maxAttempts = count * 400
  let found = 0
  for (let attempt = 0; attempt < maxAttempts && found < count; attempt++) {
    const cx = quantizeStateValue(region.cx + (random() * 2 - 1) * region.radius)
    const cy = quantizeStateValue(region.cy + (random() * 2 - 1) * region.radius)
    if (inMainCardioid(cx, cy) || inPeriod2Bulb(cx, cy)) {
      continue
    }
    const escape = mandelbrotEscape(cx, cy, SEED_MAX_ITER)
    if (escape < SEED_MIN_ESCAPE || escape >= SEED_MAX_ITER) {
      continue
    }
    out[found * 2] = cx
    out[found * 2 + 1] = cy
    found++
  }
  return out.subarray(0, found * 2)
}

/**
 * Uniform (aspect-preserving) scale factors mapping a complex coordinate to clip space, so that
 * `±viewScale` spans the SHORTER edge of the canvas and the longer edge shows proportionally more
 * of the plane.
 *
 * The original mapping divided both axes by the same constant, which is only correct on a square
 * canvas: clip space maps to each axis of the viewport independently, so on a 2.4:1 canvas it
 * stretched the whole plane 2.4x horizontally and no amount of colour tuning could make the
 * silhouette recognisable. The extra width this exposes is not wasted - it fills with the genuine
 * faint outer halo of escaping trajectories rather than going black.
 */
export const projectionScale = (width: number, height: number, viewScale: number): [number, number] => {
  const aspect = Math.max(width, 1) / Math.max(height, 1)
  return aspect >= 1
    ? [1 / (viewScale * aspect), 1 / viewScale]
    : [1 / viewScale, aspect / viewScale]
}

/**
 * The density the hottest pixel is expected to be sitting at right now - what the present pass
 * normalises against so the image auto-exposes as it converges.
 *
 * Reading the real maximum back off the GPU would mean either a reduction pass or a pipeline-
 * stalling readPixels every frame; the density field is predictable enough not to need either.
 * Monotonic integration (`decayFactor >= 1`) grows the mean linearly with `frames`; with decay it
 * settles at `1 / (1 - decayFactor)` frames' worth instead. `peakOverMean` is the one tuned knob:
 * a Buddhabrot's hottest filaments run far above its mean, and that ratio is what sets how much
 * headroom the tonemap leaves before the core clips flat.
 */
export const estimateNormalisation = (
  frames: number,
  pointsPerFrame: number,
  texels: number,
  densityIncrement: number,
  decayFactor: number,
  peakOverMean: number,
): number => {
  const effectiveFrames = decayFactor >= 1 ? Math.max(frames, 1) : 1 / Math.max(1 - decayFactor, 1e-6)
  const mean = (effectiveFrames * pointsPerFrame * densityIncrement) / Math.max(texels, 1)
  return Math.max(mean * peakOverMean, 1e-6)
}

/**
 * The present pass's tonemap curve, mirrored in JS so its shape is testable: a log lift of
 * `density` relative to `norm`, normalised to 0-1.
 *
 * Linear exposure cannot render this image. A Buddhabrot spans orders of magnitude between its hot
 * core and the faint filaments that carry all the detail, so any linear mapping either clips the
 * core to a flat block or leaves the filaments at zero - which is exactly the two-flat-bands result
 * the 8-bit linear version produced.
 */
export const logTone = (density: number, norm: number, k: number): number => {
  const t = Math.max(density, 0) / Math.max(norm, 1e-6)
  return Math.min(1, Math.max(0, Math.log(1 + t * k) / Math.log(1 + k)))
}

export const buildStateUvGrid = (width: number, height: number): Float32Array => {
  const out = new Float32Array(width * height * 2)
  let i = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[i++] = (x + 0.5) / width
      out[i++] = (y + 0.5) / height
    }
  }
  return out
}
