import { describe, expect, it } from 'vitest'
import { button, cx, markerPill, sw, toneBg, toneFill, toneText } from '../../helpers/ui'
import type { ButtonSize, ButtonVariant, ToggleKey, Tone } from '../../types/ui'

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'quiet', 'danger', 'ghost']
const SIZES: ButtonSize[] = ['sm', 'md', 'lg']
const TOGGLE_KEYS: ToggleKey[] = ['tab', 'chip', 'keyChip', 'switchBtn', 'countPill', 'underTab']
const TONES: Tone[] = ['accent', 'success', 'warning', 'danger', 'info', 'muted']

// A CSS property that both an idle string and an on/active string set for the same key. Two
// classes touching the same property resolve by stylesheet order, not by string position, so a
// toggle state must replace its idle pair rather than sit next to it - this is the failure mode
// every recipe in helpers/ui.ts is built to avoid.
const BG_UTILITY = /(?:^|\s)bg-(?!transparent\b)\S+/g

describe('cx', () => {
  it('joins truthy class fragments with a single space', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c')
  })

  it('drops falsy fragments', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  it('returns an empty string when nothing is truthy', () => {
    expect(cx(false, null, undefined)).toBe('')
  })
})

describe('button', () => {
  it('defaults to a medium primary button', () => {
    const classes = button()
    expect(classes).toContain('bg-amber-400')
    expect(classes).toContain('h-[34px]')
  })

  it.each(VARIANTS)('composes every size for the %s variant without throwing', (variant) => {
    for (const size of SIZES) {
      expect(button(variant, size)).toEqual(expect.any(String))
    }
  })

  it('appends extra classes verbatim', () => {
    expect(button('primary', 'md', 'mt-4')).toMatch(/mt-4$/)
  })

  it('always disables via the shared disabled utilities', () => {
    for (const variant of VARIANTS) {
      expect(button(variant)).toContain('disabled:opacity-40')
    }
  })

  it.each(['secondary', 'quiet', 'ghost'] as const)('replaces the idle colour with the on colour for %s (no stacking)', (variant) => {
    const idle = button(variant, 'md', '', false)
    const on = button(variant, 'md', '', true)
    const idleBgs = idle.match(BG_UTILITY) ?? []
    const onBgs = on.match(BG_UTILITY) ?? []
    // The toggle state must not retain the idle background alongside its own - that would leave
    // two same-property utilities in the class list with an outcome that depends on stylesheet
    // order rather than the `on` prop.
    for (const bg of idleBgs) {
      expect(onBgs).not.toContain(bg)
    }
    expect(on).toContain('text-amber-400')
  })

  it.each(VARIANTS)('icon-only mode is a square, never combined with the text-mode height/padding classes (%s)', (variant) => {
    for (const size of SIZES) {
      const classes = button(variant, size, '', false, true).split(' ')
      expect(classes.some(c => c.startsWith('size-['))).toBe(true)
      expect(classes.some(c => c.startsWith('px-') || c.startsWith('h-['))).toBe(false)
    }
  })

  it.each(['primary', 'danger'] as const)('falls back to an outline ring for the %s action variant, keeping its idle fill', (variant) => {
    const idle = button(variant)
    const on = button(variant, 'md', '', true)
    expect(on).toContain('outline-amber-400/60')
    // Action variants have no dedicated toggle colour - the idle fill must survive untouched.
    for (const bg of idle.match(BG_UTILITY) ?? []) {
      expect(on).toContain(bg)
    }
  })
})

describe('sw', () => {
  it.each(TOGGLE_KEYS)('returns the base classes plus the idle pair when off (%s)', (key) => {
    const off = sw(key, false)
    const on = sw(key, true)
    expect(off).not.toBe(on)
  })

  it.each(TOGGLE_KEYS)('never lets the on and idle colour utilities coexist (%s)', (key) => {
    const on = sw(key, true)
    const off = sw(key, false)
    const offOnly = off.split(' ').filter(c => !on.includes(c))
    // Every class unique to the idle state must be a colour utility that the on state replaced,
    // not one still lingering in the on state's class list.
    for (const cls of offOnly) {
      expect(on.split(' ')).not.toContain(cls)
    }
  })
})

describe('tone maps', () => {
  it('define every tone for text, background and fill', () => {
    for (const tone of TONES) {
      expect(toneText[tone]).toEqual(expect.any(String))
      expect(toneBg[tone]).toEqual(expect.any(String))
      expect(toneFill[tone]).toEqual(expect.any(String))
    }
  })

})

describe('markerPill', () => {
  it('defines a rule and a tab for every tone, each naming that tone\'s own colour', () => {
    // Literal per-tone strings, not string interpolation - Tailwind's static content scan can't see
    // through a built `border-${tone}/20`, so this guards against that regression creeping back in.
    for (const tone of TONES) {
      expect(markerPill[tone].rule).toEqual(expect.any(String))
      expect(markerPill[tone].tab).toEqual(expect.any(String))
    }
    expect(markerPill.accent.tab).toContain('amber-400')
    expect(markerPill.info.tab).toContain('info')
  })
})
