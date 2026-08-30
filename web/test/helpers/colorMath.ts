// WCAG contrast helpers for the design-token tests. Not shipped app code - this only exists so
// theme.test.ts can verify the colour ramps in assets/css/theme.css actually meet contrast
// requirements, instead of trusting the numbers by eye.

export type Rgb = [number, number, number]

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

// sRGB gamma encode: linear channel (0-1) -> display channel (0-1).
const gammaEncode = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * clamp01(c) ** (1 / 2.4) - 0.055

// sRGB gamma decode: display channel (0-255) -> linear channel (0-1). Used for WCAG relative
// luminance, which is defined on linear-light values, not the gamma-encoded ones a colour
// picker or hex code gives you.
const gammaDecode = (c255: number): number => {
  const c = c255 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = Number.parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// oklch(L C H) -> sRGB 0-255, via OKLab (Björn Ottosson's matrices). Alpha, if present
// (`oklch(L C H / A)`), is parsed but callers composite it themselves with compositeOver.
export const oklchToRgb = (value: string): Rgb => {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value)
  if (!match) {
    throw new Error(`not an oklch() value: ${value}`)
  }
  const [, lStr, cStr, hStr] = match
  const L = Number(lStr)
  const C = Number(cStr)
  const hRad = (Number(hStr) * Math.PI) / 180

  const a = C * Math.cos(hRad)
  const b = C * Math.sin(hRad)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b

  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3

  const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

  return [rLin, gLin, bLin].map(c => Math.round(clamp01(gammaEncode(c)) * 255)) as Rgb
}

export const parseColor = (value: string): Rgb =>
  value.trim().startsWith('#') ? hexToRgb(value.trim()) : oklchToRgb(value)

// Alpha-blend a foreground colour over an opaque background, both already gamma-encoded sRGB -
// how a browser composites `color: oklch(... / a)` text over a solid page background.
export const compositeOver = ([fr, fg, fb]: Rgb, alpha: number, [br, bg, bb]: Rgb): Rgb => [
  Math.round(fr * alpha + br * (1 - alpha)),
  Math.round(fg * alpha + bg * (1 - alpha)),
  Math.round(fb * alpha + bb * (1 - alpha)),
]

export const relativeLuminance = ([r, g, b]: Rgb): number =>
  0.2126 * gammaDecode(r) + 0.7152 * gammaDecode(g) + 0.0722 * gammaDecode(b)

export const contrastRatio = (a: Rgb, b: Rgb): number => {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b))
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}
