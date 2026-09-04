// Pure maths for the Julia preset's target picker (components/visualizer/Canvas.vue). No WebGL,
// no Vue - same split as juliaPath.ts/hueMorph.ts, which is what makes this unit-testable without
// a canvas.
//
// Chaos and Fractal both get `c` from juliaPath.ts's getBoundaryJuliaPath(), which is validated
// (mandelbrotEscape() kept in a tuned escape-count window) to never land deep inside the set. The
// original Julia preset instead picked `c` from a small-magnitude (0.35-0.8), unvalidated live
// circle orbit - and small |c| is exactly backwards: c=0 gives the Julia set as the exact unit
// disk (entirely interior), and every |c| tested below 1.0 or so stays close enough to that
// regime that LARGE connected regions of the visible frame land inside the filled set, reading as
// one flat colour - the reported "single blob" bug. It took an actual numeric sweep (not
// intuition) to find this: a naive "did every probe fail to escape" check never found a near-100%
// blob anywhere in that radius range, because the real mechanism isn't points literally never
// escaping - it's the SHADER's structure/colour formula saturating to a constant (chaosMix() picks
// the same anchor) for any point whose smooth escape value climbs much past ~0.6, which a much
// wider swath of the frame does at small |c| even though most of those points technically do
// escape eventually. See juliaSmoothEscape() and JULIA_HIGH_THRESHOLD below.

/**
 * Smooth escape value (0-1) for z <- z^power + c starting at (z0x, z0y), or 1.0 if it never
 * escapes within maxIter. `power` is a positive integer here (a CPU probe using the nearest
 * integer power is a fine proxy for the shader's actual floor/ceil blend - both real neighbouring
 * Julia sets, so if one predicts trouble the blended pair reads that way too). The repeated-
 * multiplication approach and the exact escape-count formula both mirror the shader's own
 * zpow()/juliaField() - this has to predict what the GPU will actually render, not just whether a
 * point escapes at all.
 */
export const juliaSmoothEscape = (
  z0x: number,
  z0y: number,
  cx: number,
  cy: number,
  power: number,
  maxIter: number,
): number => {
  let zx = z0x
  let zy = z0y
  let esc = 0
  for (let i = 0; i < maxIter; i++) {
    let rx = zx
    let ry = zy
    for (let k = 1; k < power; k++) {
      const nx = rx * zx - ry * zy
      const ny = rx * zy + ry * zx
      rx = nx
      ry = ny
    }
    zx = rx + cx
    zy = ry + cy
    const dz = zx * zx + zy * zy
    if (dz > 16) {
      const smooth = esc + 1 - Math.log2(Math.max(Math.log2(dz), 0.0001)) / Math.log2(power)
      return Math.max(0, Math.min(1, smooth / maxIter))
    }
    esc += 1
  }
  return 1
}

/** An n x n grid of (x, y) points spanning [-span, span] on both axes, evenly spaced - the probe
 * positions used to sample how a candidate (c, power) would actually render across the frame. */
export const buildProbeGrid = (n: number, span: number): Array<[number, number]> => {
  const points: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      points.push([
        -span + (2 * span) * (i / (n - 1)),
        -span + (2 * span) * (j / (n - 1)),
      ])
    }
  }
  return points
}

// The shader's structure formula (shade * 1.5 + bands * ring * 0.3 - 0.15, clamped 0-1) saturates
// to exactly 1.0 - the same colour anchor for every such pixel - once shade alone clears
// 1.15 / 1.5 ≈ 0.767, i.e. once the smooth escape value climbs past roughly pow(0.767, 1/1.25) -
// but bands/ring can push that saturation point as low as ~0.63 depending on where a pixel's
// escape count happens to land. 0.6 is deliberately the more conservative (lower) of those two, so
// this rejects a candidate for having "too much high-escape area" slightly before the shader would
// actually start visibly flattening, not exactly at the edge of it.
const JULIA_HIGH_THRESHOLD = 0.6
// A pixel below this barely escaped at all - shade is close to 0, reading as background. Used only
// to keep a candidate from being almost entirely empty, the opposite failure from the blob.
const JULIA_LOW_THRESHOLD = 0.1

export interface JuliaFieldStats {
  /** Fraction of probes at or above JULIA_HIGH_THRESHOLD - how much of the frame would read as one
   * flat, saturated colour. Low is good. */
  highFraction: number
  /** Fraction of probes strictly between the two thresholds - genuine escape-time variety, the
   * actual filigree/texture a Julia preset is supposed to show. High is good. */
  texturedFraction: number
}

export const juliaFieldStats = (
  cx: number,
  cy: number,
  power: number,
  maxIter: number,
  probes: ReadonlyArray<readonly [number, number]>,
): JuliaFieldStats => {
  let high = 0
  let textured = 0
  for (const [px, py] of probes) {
    const m = juliaSmoothEscape(px, py, cx, cy, power, maxIter)
    if (m >= JULIA_HIGH_THRESHOLD) {
      high++
    }
    else if (m > JULIA_LOW_THRESHOLD) {
      textured++
    }
  }
  return { highFraction: high / probes.length, texturedFraction: textured / probes.length }
}

// The view scale JULIA's shader actually renders at (replacing the old fixed 1.3, which - per the
// sweep this module's header describes - was simply too wide a view of a dendrite to ever show
// much texture: Julia sets read as filigree only when framed fairly tightly around the boundary,
// the same reason Chaos's own zoom is "0.5x to 5x", not a flat wide shot). Exported so
// helpers/visualizer/shaders.ts's JULIA preset and this picker are provably looking at the same
// view - a mismatch here would make the picker validate a frame the shader never actually draws.
export const JULIA_VIEW_SCALE = 0.35
// The radius band a numeric sweep found reliably free of the small-|c| blob regime while still
// producing real texture (see the module header) - candidates are rejected outside this band, not
// searched beyond it.
export const JULIA_RADIUS_MIN = 0.75
export const JULIA_RADIUS_MAX = 1.05
const JULIA_MAX_HIGH_FRACTION = 0.35
const JULIA_MIN_TEXTURED_FRACTION = 0.15
const PROBE_GRID_SIZE = 11
const PROBE_MAX_ITER = 36

const PROBES = buildProbeGrid(PROBE_GRID_SIZE, JULIA_VIEW_SCALE)

export interface JuliaTarget {
  power: number
  cx: number
  cy: number
}

/**
 * Pick a random Julia target (power + c) whose rendered frame would have real escape-time
 * texture rather than reading as one flat colour or almost nothing. Tries `attempts` random
 * candidates and keeps the best-scoring one seen (texturedFraction minus highFraction) - not just
 * the first one to clear the accept thresholds - so a run of only mediocre rolls still returns the
 * least-bad of them rather than whatever was drawn last, matching juliaPath.ts's own "always
 * produce something real" philosophy for its boundary search.
 */
export const pickJuliaTarget = (
  powerMin: number,
  powerMax: number,
  attempts = 32,
  random: () => number = Math.random,
): JuliaTarget => {
  let best: JuliaTarget = { power: powerMin, cx: JULIA_RADIUS_MIN, cy: 0 }
  let bestScore = -Infinity
  for (let i = 0; i < attempts; i++) {
    const power = powerMin + random() * (powerMax - powerMin)
    const roundedPower = Math.max(2, Math.round(power))
    const radius = JULIA_RADIUS_MIN + random() * (JULIA_RADIUS_MAX - JULIA_RADIUS_MIN)
    const theta = random() * Math.PI * 2
    const cx = Math.cos(theta) * radius
    const cy = Math.sin(theta) * radius
    const stats = juliaFieldStats(cx, cy, roundedPower, PROBE_MAX_ITER, PROBES)
    const score = stats.texturedFraction - stats.highFraction
    const passes = stats.highFraction <= JULIA_MAX_HIGH_FRACTION && stats.texturedFraction >= JULIA_MIN_TEXTURED_FRACTION
    // A passing candidate always outranks a failing one, regardless of raw score - once something
    // clears both thresholds, only another passing candidate should ever replace it.
    const rank = (passes ? 1 : 0) * 10 + score
    if (rank > bestScore) {
      bestScore = rank
      best = { power, cx, cy }
    }
  }
  return best
}
