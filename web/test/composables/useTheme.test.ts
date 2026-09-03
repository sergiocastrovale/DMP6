import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { decodeThemePreference, useTheme } from '../../composables/useTheme'
import { DEFAULT_THEME, DEFAULT_UI_SIZE, THEME_STORAGE_KEY } from '../../helpers/constants'

// Same shared-state stub useSidebar.test.ts uses: `useState` is a Nuxt auto-import with no app
// context here, so back it with a plain per-key ref map.
mockNuxtImport('useState', () => {
  const stateMap = new Map<string, ReturnType<typeof ref>>()
  return (key: string, init: () => unknown) => {
    if (!stateMap.has(key)) {stateMap.set(key, ref(init()))}
    return stateMap.get(key)!
  }
})

const stored = () => JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)

describe('decodeThemePreference', () => {
  it('defaults when nothing is stored', () => {
    expect(decodeThemePreference(null)).toEqual({ accent: DEFAULT_THEME, size: DEFAULT_UI_SIZE })
  })

  it('reads the {accent, size} object', () => {
    expect(decodeThemePreference('{"accent":"cyan","size":"xl"}')).toEqual({ accent: 'cyan', size: 'xl' })
  })

  // The entry used to hold a bare accent id, before UI size existed - an existing browser must keep
  // its colour rather than silently reverting to amber.
  it('reads the legacy bare-accent format', () => {
    expect(decodeThemePreference('violet')).toEqual({ accent: 'violet', size: DEFAULT_UI_SIZE })
  })

  it('falls back per field on unknown values, and wholesale on corrupt JSON', () => {
    expect(decodeThemePreference('{"accent":"chartreuse","size":"xl"}')).toEqual({ accent: DEFAULT_THEME, size: 'xl' })
    expect(decodeThemePreference('{"accent":"rose","size":"enormous"}')).toEqual({ accent: 'rose', size: DEFAULT_UI_SIZE })
    expect(decodeThemePreference('{not json')).toEqual({ accent: DEFAULT_THEME, size: DEFAULT_UI_SIZE })
  })
})

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.size
  })

  it('starts on the defaults', () => {
    const { accent, size } = useTheme()
    expect(accent.value).toBe(DEFAULT_THEME)
    expect(size.value).toBe(DEFAULT_UI_SIZE)
  })

  it('setAccent applies the palette to <html> and persists both fields', () => {
    const { accent, setAccent } = useTheme()

    setAccent('violet')

    expect(accent.value).toBe('violet')
    expect(document.documentElement.dataset.theme).toBe('violet')
    expect(stored()).toEqual({ accent: 'violet', size: DEFAULT_UI_SIZE })
  })

  it('setSize applies the scale to <html> without disturbing the accent', () => {
    const { accent, size, setAccent, setSize } = useTheme()
    setAccent('cyan')

    setSize('xl')

    expect(size.value).toBe('xl')
    expect(accent.value).toBe('cyan')
    expect(document.documentElement.dataset.size).toBe('xl')
    expect(stored()).toEqual({ accent: 'cyan', size: 'xl' })
  })

  it('ignores unknown ids rather than writing a value with no CSS block', () => {
    const { accent, size, setAccent, setSize } = useTheme()
    setAccent('green')
    setSize('lg')

    setAccent('chartreuse' as never)
    setSize('enormous' as never)

    expect(accent.value).toBe('green')
    expect(size.value).toBe('lg')
    expect(stored()).toEqual({ accent: 'green', size: 'lg' })
  })

  it('survives localStorage throwing (private mode) - the choice still applies for the session', () => {
    const { accent, setAccent } = useTheme()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => setAccent('rose')).not.toThrow()
    expect(accent.value).toBe('rose')
    expect(document.documentElement.dataset.theme).toBe('rose')

    setItem.mockRestore()
  })

  it('exposes every option the pickers render', () => {
    const { themes, uiSizes } = useTheme()
    expect(themes.map(t => t.id)).toEqual(['amber', 'green', 'cyan', 'violet', 'rose'])
    expect(uiSizes.map(s => s.id)).toEqual(['xs', 'sm', 'default', 'lg', 'xl', '2xl'])
  })
})
