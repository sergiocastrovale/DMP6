import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compositeOver, contrastRatio, parseColor } from '../helpers/colorMath'

// vitest's root is the `web/` package directory (see vitest.config.ts), so resolve against
// process.cwd() rather than import.meta.url - the latter isn't reliably a file: URL once vite's
// SSR transform pipeline has rewritten the module.
const themePath = resolvePath(process.cwd(), 'assets/css/theme.css')
const themeSource = readFileSync(themePath, 'utf-8')

// Pull every `--name: value;` declared inside the @theme static block into a plain map, then
// resolve `var(--other-name)` references so aliases (--color-accent -> --color-amber-400) test
// against the value they actually render as.
const RAW: Record<string, string> = {}
for (const match of themeSource.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
  const [, name, value] = match
  if (name && value) {
    RAW[name] = value.trim()
  }
}

const resolve = (name: string, seen = new Set<string>()): string => {
  if (seen.has(name)) {
    throw new Error(`circular token reference: ${[...seen, name].join(' -> ')}`)
  }
  const value = RAW[name]
  if (value === undefined) {
    throw new Error(`token not defined: --${name}`)
  }
  const ref = /^var\(--([\w-]+)\)$/.exec(value)
  if (!ref) {
    return value
  }
  const [, refName] = ref
  if (!refName) {
    throw new Error(`malformed var() reference: ${value}`)
  }
  return resolve(refName, new Set(seen).add(name))
}

const HUES = ['stone', 'amber', 'green', 'orange', 'red', 'violet'] as const
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const ALIASES = ['accent', 'on-accent', 'success', 'warning', 'danger', 'info'] as const

describe('theme.css ramps', () => {
  it.each(HUES)('%s has all eleven steps', (hue) => {
    for (const step of STEPS) {
      expect(RAW[`color-${hue}-${step}`], `--color-${hue}-${step}`).toBeDefined()
    }
  })

  it.each(HUES)('%s steps are parseable colours in darkest-to-lightest order', (hue) => {
    // Every ramp goes 50 (lightest) -> 950 (darkest): each step's parsed luminance must not
    // exceed the previous one's. Guards against a mis-keyed or transposed ramp entry.
    let previousLuminance = Number.POSITIVE_INFINITY
    for (const step of STEPS) {
      const rgb = parseColor(resolve(`color-${hue}-${step}`))
      const luminance = rgb.reduce((sum, c) => sum + c, 0)
      expect(luminance).toBeLessThanOrEqual(previousLuminance)
      previousLuminance = luminance
    }
  })
})

describe('theme.css semantic aliases', () => {
  it.each(ALIASES)('--color-%s resolves to a parseable colour', (alias) => {
    expect(() => parseColor(resolve(`color-${alias}`))).not.toThrow()
  })
})

describe('theme.css type scale', () => {
  it('is ordered smallest to largest across all nine steps', () => {
    const steps = ['2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl']
    const sizes = steps.map(step => Number.parseFloat(resolve(`text-${step}`)))
    const sorted = [...sizes].sort((a, b) => a - b)
    expect(sizes).toEqual(sorted)
  })
})

describe('theme.css contrast', () => {
  const stone950 = parseColor(resolve('color-stone-950'))
  const stone900 = parseColor(resolve('color-stone-900'))
  const stone100 = parseColor(resolve('color-stone-100'))
  const accent = parseColor(resolve('color-accent'))
  const onAccent = parseColor(resolve('color-on-accent'))

  it('primary text (stone-100) clears 4.5:1 on both page and card surfaces', () => {
    expect(contrastRatio(stone100, stone950)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(stone100, stone900)).toBeGreaterThanOrEqual(4.5)
  })

  it('secondary body text (stone-100 at 60%) clears 4.5:1 composited over the page surface', () => {
    // ui.typography.body renders paragraph copy at this exact weight - it carries real content,
    // not decoration, so it is held to the full body-text threshold.
    const composited = compositeOver(stone100, 0.6, stone950)
    expect(contrastRatio(composited, stone950)).toBeGreaterThanOrEqual(4.5)
  })

  it('tertiary text (stone-100 at 40%) still clears the large-text/UI-component floor of 3:1', () => {
    const composited = compositeOver(stone100, 0.4, stone950)
    expect(contrastRatio(composited, stone950)).toBeGreaterThanOrEqual(3)
  })

  it('on-accent text clears 4.5:1 on the accent fill (primary button label)', () => {
    expect(contrastRatio(onAccent, accent)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['success', 'warning', 'danger', 'info'] as const)('%s text clears 4.5:1 on the page surface', (alias) => {
    const rgb = parseColor(resolve(`color-${alias}`))
    expect(contrastRatio(rgb, stone950)).toBeGreaterThanOrEqual(4.5)
  })

  it('accent text (amber-400) clears 4.5:1 on both page and card surfaces', () => {
    // The single most common non-neutral text colour in the app - links, active nav/tab state,
    // icon accents (toneText.accent, hover states) - all read this exact token.
    expect(contrastRatio(accent, stone950)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(accent, stone900)).toBeGreaterThanOrEqual(4.5)
  })
})
