// oklch → sRGB → HSV hue.
//
// The design tokens are authored in oklch (assets/css/theme.css), but a WebGL shader picks colour
// out of an HSV wheel, and the two hue angles are NOT the same number: amber's oklch hue of 75°
// is around 40° in HSV. Feeding the oklch angle straight to hsv2rgb turned the amber accent green.
//
// getComputedStyle is no help either - it serializes these back as `oklch(…)`, not resolved sRGB -
// so the conversion is done here, on the values the stylesheet itself declares.

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

// oklab's inverse transform, then linear sRGB, then the sRGB transfer function. Out-of-gamut
// results are clipped per channel rather than gamut-mapped: every ramp in theme.css was already
// trimmed to sit inside sRGB, so clipping is a guard, not a colour decision.
export const oklchToRgb = (l: number, c: number, hDegrees: number): [number, number, number] => {
  const h = (hDegrees * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = l - 0.0894841775 * a - 1.2914855480 * b

  const lCube = lRoot ** 3
  const mCube = mRoot ** 3
  const sCube = sRoot ** 3

  const linear = [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.7076147010 * sCube,
  ]

  return linear.map((channel) => {
    const v = clamp01(channel)
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  }) as [number, number, number]
}

/** HSV hue in degrees (0-360) for an sRGB triple of 0-1 components. Grey returns 0. */
export const rgbToHueDegrees = ([r, g, b]: [number, number, number]): number => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) {
    return 0
  }
  const hue = max === r
    ? ((g - b) / delta) % 6
    : max === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4
  return ((hue * 60) % 360 + 360) % 360
}

export const oklchToHueDegrees = (l: number, c: number, h: number): number =>
  rgbToHueDegrees(oklchToRgb(l, c, h))
