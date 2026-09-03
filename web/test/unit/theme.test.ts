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
  const STEPS_BY_NAME = ['2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl']

  // Every step is `calc(<px> * var(--ui-scale, 1))` so Settings → Themes' size stepper can rescale
  // the lot - pull the base px back out rather than parseFloat'ing the calc() (which yields NaN and
  // would make the ordering assertion below pass vacuously).
  const basePx = (step: string): number => {
    const value = resolve(`text-${step}`)
    const match = /calc\(\s*([\d.]+)px\s*\*\s*var\(--ui-scale/.exec(value)
    expect(match, `--text-${step} must scale with --ui-scale, got: ${value}`).not.toBeNull()
    return Number(match![1])
  }

  it('is ordered smallest to largest across all eleven steps', () => {
    const sizes = STEPS_BY_NAME.map(basePx)
    expect(sizes.every(Number.isFinite)).toBe(true)
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
  })

  it('every step multiplies by --ui-scale, so the size stepper misses nothing', () => {
    // basePx() asserts the shape; this just pins the intent for anyone adding a step later.
    expect(STEPS_BY_NAME.map(basePx)).toHaveLength(11)
  })
})

describe('themes.css UI sizes', () => {
  it('declares a --ui-scale default plus one block per non-default size', () => {
    const source = readFileSync(resolvePath(process.cwd(), 'assets/css/themes.css'), 'utf-8')
    expect(source).toMatch(/:root\s*\{[^}]*--ui-scale:\s*1;/)

    const sizes = [...source.matchAll(/html\[data-size='([\w-]+)']\s*\{\s*--ui-scale:\s*([\d.]+);/g)]
      .map(m => [m[1], Number(m[2])] as const)
    // `default` is the :root value and needs no block; the rest span smaller -> larger.
    expect(sizes.map(([id]) => id)).toEqual(['xs', 'sm', 'lg', 'xl', '2xl'])
    expect(sizes.map(([, scale]) => scale)).toEqual([0.85, 0.95, 1.1, 1.2, 1.25])
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

// Settings → Themes swaps the accent by redefining the amber ramp per `html[data-theme=…]` block
// (see assets/css/themes.css), so each alternate palette has to clear the same bar the default one
// does above - otherwise picking a theme silently drops the app below AA.
const themesSource = readFileSync(resolvePath(process.cwd(), 'assets/css/themes.css'), 'utf-8')

const themeBlocks: Record<string, Record<string, string>> = {}
for (const block of themesSource.matchAll(/html\[data-theme='([\w-]+)']\s*\{([^}]*)\}/g)) {
  const [, name, body] = block
  if (!name || !body) {
    continue
  }
  const tokens: Record<string, string> = {}
  for (const decl of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const [, token, value] = decl
    if (token && value) {
      tokens[token] = value.trim()
    }
  }
  themeBlocks[name] = tokens
}

const THEME_IDS = Object.keys(themeBlocks)

describe('themes.css alternate accent palettes', () => {
  const stone950 = parseColor(resolve('color-stone-950'))
  const stone900 = parseColor(resolve('color-stone-900'))

  it('defines a block for every non-default theme', () => {
    // `amber` is the default and deliberately has no block - it IS theme.css's ramp.
    expect(THEME_IDS.sort()).toEqual(['cyan', 'green', 'rose', 'violet'])
  })

  it.each(THEME_IDS)('%s redefines all eleven amber steps plus on-accent', (id) => {
    for (const step of STEPS) {
      expect(themeBlocks[id]![`color-amber-${step}`], `${id}: --color-amber-${step}`).toBeDefined()
    }
    expect(themeBlocks[id]!['color-on-accent'], `${id}: --color-on-accent`).toBeDefined()
  })

  it.each(THEME_IDS)('%s steps are parseable colours in darkest-to-lightest order', (id) => {
    let previousLuminance = Number.POSITIVE_INFINITY
    for (const step of STEPS) {
      const rgb = parseColor(themeBlocks[id]![`color-amber-${step}`]!)
      const luminance = rgb.reduce((sum, c) => sum + c, 0)
      expect(luminance).toBeLessThanOrEqual(previousLuminance)
      previousLuminance = luminance
    }
  })

  it.each(THEME_IDS)('%s accent clears 4.5:1 on both page and card surfaces', (id) => {
    const themeAccent = parseColor(themeBlocks[id]!['color-amber-400']!)
    expect(contrastRatio(themeAccent, stone950)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(themeAccent, stone900)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(THEME_IDS)('%s on-accent text clears 4.5:1 on its own accent fill', (id) => {
    const themeAccent = parseColor(themeBlocks[id]!['color-amber-400']!)
    const themeOnAccent = parseColor(themeBlocks[id]!['color-on-accent']!)
    expect(contrastRatio(themeOnAccent, themeAccent)).toBeGreaterThanOrEqual(4.5)
  })

  it('every theme has a swatch preview var, including the default', () => {
    const swatches = [...themesSource.matchAll(/--swatch-([\w-]+):/g)].map(m => m[1])
    expect(swatches.sort()).toEqual(['amber', 'cyan', 'green', 'rose', 'violet'])
  })
})
