import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTheme } from '../../composables/useTheme'
import { DEFAULT_THEME, THEME_STORAGE_KEY } from '../../helpers/constants'

// Same shared-state stub useSidebar.test.ts uses: `useState` is a Nuxt auto-import with no app
// context here, so back it with a plain per-key ref map.
mockNuxtImport('useState', () => {
  const stateMap = new Map<string, ReturnType<typeof ref>>()
  return (key: string, init: () => unknown) => {
    if (!stateMap.has(key)) {stateMap.set(key, ref(init()))}
    return stateMap.get(key)!
  }
})

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('starts on the default theme', () => {
    const { theme } = useTheme()
    expect(theme.value).toBe(DEFAULT_THEME)
  })

  it('setTheme applies the palette to <html> and persists it', () => {
    const { theme, setTheme } = useTheme()

    setTheme('violet')

    expect(theme.value).toBe('violet')
    expect(document.documentElement.dataset.theme).toBe('violet')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('violet')
  })

  it('ignores an unknown id rather than writing a theme with no CSS block', () => {
    const { theme, setTheme } = useTheme()
    setTheme('green')

    setTheme('chartreuse' as never)

    expect(theme.value).toBe('green')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('green')
  })

  it('survives localStorage throwing (private mode) - the theme still applies for the session', () => {
    const { theme, setTheme } = useTheme()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => setTheme('rose')).not.toThrow()
    expect(theme.value).toBe('rose')
    expect(document.documentElement.dataset.theme).toBe('rose')

    setItem.mockRestore()
  })

  it('exposes every theme the picker renders', () => {
    const { themes } = useTheme()
    expect(themes.map(t => t.id)).toEqual(['amber', 'green', 'cyan', 'violet', 'rose'])
  })
})
