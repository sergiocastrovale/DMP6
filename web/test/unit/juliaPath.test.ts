import { describe, expect, it } from 'vitest'
import {
  boundaryJuliaC, cardioidPoint, getBoundaryJuliaPath, juliaCAlongPath, mandelbrotEscape,
} from '../../helpers/visualizer/juliaPath'

const MAX_ITER = 300

describe('mandelbrotEscape', () => {
  it('never escapes from deep inside the set', () => {
    expect(mandelbrotEscape(0, 0)).toBe(MAX_ITER)
    expect(mandelbrotEscape(-1, 0)).toBe(MAX_ITER)
  })

  it('escapes immediately from far outside it', () => {
    expect(mandelbrotEscape(4, 4)).toBeLessThan(5)
  })

  it('takes longer the closer c sits to the boundary', () => {
    expect(mandelbrotEscape(-0.7269, 0.1889)).toBeGreaterThan(mandelbrotEscape(2, 2))
  })
})

describe('cardioidPoint', () => {
  // c(0) = 1/2 - 1/4 = 0.25, the cusp; c(π) = -1/2 - 1/4·1 = -0.75, where the period-2 bulb hangs.
  it('traces the main cardioid, cusp to bulb-attachment', () => {
    const [cuspX, cuspY] = cardioidPoint(0)
    expect(cuspX).toBeCloseTo(0.25, 6)
    expect(cuspY).toBeCloseTo(0, 6)

    const [leftX, leftY] = cardioidPoint(Math.PI)
    expect(leftX).toBeCloseTo(-0.75, 6)
    expect(leftY).toBeCloseTo(0, 6)
  })

  it('puts every boundary point inside (or on) the set', () => {
    for (let i = 0; i < 64; i++) {
      const [x, y] = cardioidPoint((i / 64) * Math.PI * 2)
      expect(mandelbrotEscape(x, y)).toBe(MAX_ITER)
    }
  })
})

describe('boundaryJuliaC', () => {
  // The whole point of this module. A c inside the set gives a filled Julia set, whose interior
  // renders as one flat slab of colour - the "giant blob" this replaced. Radially scaling a
  // cardioid point outward from the origin does NOT guarantee this: at θ≈π that lands on -0.7875,
  // deep inside the period-2 bulb, which is exactly how the blob got on screen.
  it('never returns a constant from inside the set, anywhere along the sweep', () => {
    for (let i = 0; i < 400; i++) {
      const theta = (i / 400) * Math.PI * 2
      const [x, y] = boundaryJuliaC(theta)
      expect(mandelbrotEscape(x, y)).toBeLessThan(MAX_ITER)
    }
  })

  it('stays near the boundary rather than far outside, where structure flattens out', () => {
    for (let i = 0; i < 200; i++) {
      const theta = (i / 200) * Math.PI * 2
      const [x, y] = boundaryJuliaC(theta)
      // Far-outside constants escape in a couple of iterations and render as a smooth gradient.
      expect(mandelbrotEscape(x, y)).toBeGreaterThan(4)
    }
  })

  it('specifically clears the period-2 bulb around θ=π, the case that produced the blob', () => {
    for (const theta of [Math.PI - 0.05, Math.PI, Math.PI + 0.05]) {
      const [x, y] = boundaryJuliaC(theta)
      expect(mandelbrotEscape(x, y)).toBeLessThan(MAX_ITER)
    }
  })

  // Deliberately NOT asserting small-step continuity here: right at the Mandelbrot boundary the
  // escape-time landscape is itself discontinuous, so this search legitimately CAN land on
  // unrelated points for barely-different theta - that's the real bug report ("glitchy, jumping
  // the entire fractal"). The fix isn't making this function smoother; it's never calling it live
  // per frame. See getBoundaryJuliaPath()/juliaCAlongPath() below, which is what Canvas.vue
  // actually walks at runtime.
})

describe('getBoundaryJuliaPath', () => {
  const path = getBoundaryJuliaPath()

  it('is a closed loop, always outside the set', () => {
    expect(path.length).toBeGreaterThan(100)
    for (const [x, y] of path) {
      expect(mandelbrotEscape(x, y)).toBeLessThan(MAX_ITER)
    }
  })

  it('is cached - repeat calls return the same reference, not a rebuild', () => {
    expect(getBoundaryJuliaPath()).toBe(path)
  })

  const stepSizes = (points: readonly (readonly [number, number])[]): number[] =>
    points.map(([x0, y0], i) => {
      const [x1, y1] = points[(i + 1) % points.length]!
      return Math.hypot(x1 - x0, y1 - y0)
    })

  // This is the actual fix under test. It's deliberately relative rather than an absolute magic
  // number: raw boundaryJuliaC() output can legitimately jump between adjacent samples (previous
  // describe block - that discontinuity is real, not a bug in that function), so what matters is
  // that the smoothing + repair pass in getBoundaryJuliaPath() knocks the worst jump down by a
  // wide margin, not what the exact resulting number happens to be.
  it('has a far smaller worst-case jump than the raw search it is built from', () => {
    const raw = Array.from({ length: path.length }, (_, i) => boundaryJuliaC((i / path.length) * Math.PI * 2))
    const rawWorst = Math.max(...stepSizes(raw))
    const pathWorst = Math.max(...stepSizes(path))
    expect(pathWorst).toBeLessThan(rawWorst / 3)
  })
})

describe('juliaCAlongPath', () => {
  const path = getBoundaryJuliaPath()

  it('returns path points exactly at integer sample phases', () => {
    const [x, y] = juliaCAlongPath(path, 5 / path.length)
    expect(x).toBeCloseTo(path[5]![0], 10)
    expect(y).toBeCloseTo(path[5]![1], 10)
  })

  it('wraps phase both above 1 and below 0 onto the same loop', () => {
    const base = juliaCAlongPath(path, 0.3)
    expect(juliaCAlongPath(path, 1.3)).toEqual(base)
    expect(juliaCAlongPath(path, -0.7)).toEqual(base)
  })

  it('interpolates smoothly between samples rather than snapping to the nearer one', () => {
    const a = juliaCAlongPath(path, 0)
    const b = juliaCAlongPath(path, 1 / path.length)
    const mid = juliaCAlongPath(path, 0.5 / path.length)
    expect(mid[0]).toBeCloseTo((a[0] + b[0]) / 2, 10)
    expect(mid[1]).toBeCloseTo((a[1] + b[1]) / 2, 10)
  })
})
