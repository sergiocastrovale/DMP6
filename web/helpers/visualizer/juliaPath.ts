// Which Julia constant the Chaos preset draws, re-picked every frame on the CPU.
//
// CPU-side and not in the shader for one reason: choosing a good c needs a search (iterate the
// critical orbit, look at how fast it escapes, step, repeat), and c is identical for every pixel -
// running that search per-fragment would burn the frame budget recomputing one number a few
// million times over.
//
// The invariant it exists to enforce: c must sit just OUTSIDE the Mandelbrot set.
//   - Inside the set, the filled Julia set has genuine interior. Zooming in lands on a flat
//     plateau of colour - the "giant blob".
//   - Just outside, the Julia set is a dendrite/dust with no interior anywhere, which is the
//     spiral filigree look this preset is after.
//   - Far outside, every point escapes in a handful of iterations and the whole thing flattens
//     into a smooth gradient with no structure.
// Hence an escape-count *window*, not merely "outside".
//
// Radially scaling a cardioid-boundary point away from the origin does NOT achieve this, which is
// what the first cut did: at θ≈π the boundary point is -0.75, and scaling it out by 1.05 gives
// -0.7875 - deep inside the period-2 bulb, so the Julia set came back connected and blobby. The
// bulbs hanging off the cardioid have to be stepped over, and they vary hugely in size (the
// period-2 one is 0.5 across), so the search scans outward until it is genuinely clear of whatever
// component it started in.

const MAX_ITER = 300
// Escape counts we treat as "interesting": high enough that the structure is rich and slow to
// resolve, low enough that c is genuinely outside rather than sitting exactly on the boundary.
const MIN_ESCAPE = 30
const MAX_ESCAPE = 220
const TARGET_ESCAPE = 70
// Offsets along the outward normal to scan. The upper end has to clear the period-2 bulb.
const MIN_OFFSET = 0.0004
const MAX_OFFSET = 0.85
const SCAN_SAMPLES = 44
const BISECTION_STEPS = 22
// A classic dendrite constant, used only if the search somehow finds nothing - so this can never
// silently fall back to a blob.
const FALLBACK: readonly [number, number] = [-0.7269, 0.1889]

/**
 * Iterations before |z| > 2 for z -> z² + c starting at z = 0, or `maxIter` if it never escapes
 * (i.e. c is inside the Mandelbrot set, and the Julia set for it is connected and filled).
 */
export const mandelbrotEscape = (cx: number, cy: number, maxIter: number = MAX_ITER): number => {
  let x = 0
  let y = 0
  for (let i = 0; i < maxIter; i++) {
    const x2 = x * x
    const y2 = y * y
    if (x2 + y2 > 4) {
      return i
    }
    y = 2 * x * y + cy
    x = x2 - y2 + cx
  }
  return maxIter
}

/** The main cardioid's boundary: c(θ) = ½·e^{iθ} − ¼·e^{2iθ}. */
export const cardioidPoint = (theta: number): [number, number] => [
  0.5 * Math.cos(theta) - 0.25 * Math.cos(2 * theta),
  0.5 * Math.sin(theta) - 0.25 * Math.sin(2 * theta),
]

// Unit normal to that curve. c'(θ) = (i/2)(e^{iθ} − e^{2iθ}); rotating the tangent by -90° gives a
// normal, but which side is "out" depends on the parametrisation, so the caller checks both.
const cardioidNormal = (theta: number): [number, number] => {
  const tx = -0.5 * Math.sin(theta) + 0.5 * Math.sin(2 * theta)
  const ty = 0.5 * Math.cos(theta) - 0.5 * Math.cos(2 * theta)
  const len = Math.hypot(tx, ty) || 1
  return [ty / len, -tx / len]
}

const isOutside = (cx: number, cy: number): boolean => mandelbrotEscape(cx, cy) < MAX_ITER

/**
 * A Julia constant just outside the Mandelbrot set, swept continuously by `theta`.
 *
 * Always returns a c whose critical orbit escapes - never one from the interior - so the Chaos
 * preset's Julia set is always a dendrite with spiral filigree rather than a filled blob.
 */
export const boundaryJuliaC = (theta: number): [number, number] => {
  const [bx, by] = cardioidPoint(theta)
  let [nx, ny] = cardioidNormal(theta)

  // Pick whichever side of the curve actually leads out of the set.
  if (!isOutside(bx + nx * 0.02, by + ny * 0.02) && isOutside(bx - nx * 0.02, by - ny * 0.02)) {
    nx = -nx
    ny = -ny
  }

  const at = (offset: number): [number, number] => [bx + nx * offset, by + ny * offset]

  // Scan outward (geometrically, so the near-boundary detail gets the samples) for the first
  // offset that is clear of the set - this is what steps over a bulb of any size.
  let inside = MIN_OFFSET
  let outside = -1
  for (let i = 1; i <= SCAN_SAMPLES; i++) {
    const offset = MIN_OFFSET * (MAX_OFFSET / MIN_OFFSET) ** (i / SCAN_SAMPLES)
    const [cx, cy] = at(offset)
    if (isOutside(cx, cy)) {
      outside = offset
      break
    }
    inside = offset
  }

  if (outside < 0) {
    return [...FALLBACK] as [number, number]
  }

  // Then bisect that bracket for an escape count in the interesting window: close enough to the
  // boundary to be intricate, far enough out to have no interior.
  let lo = inside
  let hi = outside
  let best = at(hi)
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (lo + hi) / 2
    const [cx, cy] = at(mid)
    const escape = mandelbrotEscape(cx, cy)
    if (escape >= MAX_ITER || escape > TARGET_ESCAPE) {
      lo = mid
    }
    else {
      hi = mid
      best = [cx, cy]
    }
    if (escape < MAX_ITER && escape >= MIN_ESCAPE && escape <= MAX_ESCAPE) {
      best = [cx, cy]
      if (Math.abs(escape - TARGET_ESCAPE) < 12) {
        break
      }
    }
  }

  const finalEscape = mandelbrotEscape(best[0], best[1])
  return finalEscape >= MAX_ITER ? ([...FALLBACK] as [number, number]) : best
}

// boundaryJuliaC() picks a genuinely different point on the escape-window boundary for every
// theta, and right at the Mandelbrot boundary the escape-time landscape is itself discontinuous -
// that is what "fractal" means. So two thetas a frame apart can legitimately bisect to unrelated
// points, and because a Julia set is extremely sensitive to c, even a small jump in c reads as the
// ENTIRE fractal jumping to a different shape - the "glitchy" complaint. Smoothing in TIME can't
// fix this (there is nothing wrong with any single frame, each c is valid); the fix is to smooth
// in theta, once, offline: sample the raw path, blur it, and push anything the blur dragged back
// inside the set back out. The result is cached and walked by simple array interpolation at
// runtime, which is continuous by construction - no live search, no discontinuity left to hit.
const PATH_STEPS = 360
const SMOOTH_WINDOW_1 = 9
const SMOOTH_WINDOW_2 = 5
const REPAIR_STEP = 0.0025
const REPAIR_MAX_STEPS = 400

const smoothCircular = (points: readonly (readonly [number, number])[], window: number): Array<[number, number]> => {
  const n = points.length
  const half = Math.floor(window / 2)
  const out: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    let sx = 0
    let sy = 0
    for (let k = -half; k <= half; k++) {
      const [x, y] = points[(i + k + n) % n]!
      sx += x
      sy += y
    }
    out.push([sx / window, sy / window])
  }
  return out
}

// Blurring two "just outside" points that sit either side of a cusp or bulb-attachment point can
// land the average back inside (the outside region isn't locally convex there). Push radially
// outward from the origin until clear again - a coarse heuristic, but these repairs are rare,
// isolated, and get blended into their neighbours by the second smoothing pass, not something a
// viewer tracks individually.
const repairInterior = (points: readonly (readonly [number, number])[]): Array<[number, number]> =>
  points.map(([x, y]) => {
    let cx = x
    let cy = y
    let guard = 0
    while (!isOutside(cx, cy) && guard < REPAIR_MAX_STEPS) {
      const len = Math.hypot(cx, cy) || 1
      cx += (cx / len) * REPAIR_STEP
      cy += (cy / len) * REPAIR_STEP
      guard++
    }
    return [cx, cy] as [number, number]
  })

let cachedPath: ReadonlyArray<readonly [number, number]> | null = null

/**
 * A closed, smoothed loop of Julia constants that is always outside the Mandelbrot set - built
 * once (it's a pure function of the search above) and cached. Walk it with juliaCAlongPath();
 * never call boundaryJuliaC() directly per frame, which is what produced the jump-cutting.
 */
export const getBoundaryJuliaPath = (): ReadonlyArray<readonly [number, number]> => {
  if (cachedPath) {
    return cachedPath
  }
  const raw: Array<[number, number]> = []
  for (let i = 0; i < PATH_STEPS; i++) {
    raw.push(boundaryJuliaC((i / PATH_STEPS) * Math.PI * 2))
  }
  let path = repairInterior(smoothCircular(raw, SMOOTH_WINDOW_1))
  path = repairInterior(smoothCircular(path, SMOOTH_WINDOW_2))
  cachedPath = path
  return path
}

/** Linear interpolation along a closed path built by getBoundaryJuliaPath(). `phase` wraps at 1. */
export const juliaCAlongPath = (
  path: ReadonlyArray<readonly [number, number]>,
  phase: number,
): [number, number] => {
  const n = path.length
  const wrapped = ((phase % 1) + 1) % 1
  const f = wrapped * n
  const i0 = Math.floor(f) % n
  const i1 = (i0 + 1) % n
  const t = f - Math.floor(f)
  const [x0, y0] = path[i0]!
  const [x1, y1] = path[i1]!
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]
}
