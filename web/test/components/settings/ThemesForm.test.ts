import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import ThemesForm from '../../../components/settings/ThemesForm.vue'
import { themes, THEME_STORAGE_KEY } from '../../../helpers/constants'

describe('settings/ThemesForm.vue', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('renders one square per theme, each labelled and previewing its own colour', async () => {
    const wrapper = await mountSuspended(ThemesForm)
    const buttons = wrapper.findAll('button')

    expect(buttons).toHaveLength(themes.length)
    expect(buttons.map(b => b.attributes('aria-label'))).toEqual(themes.map(t => t.label))
    // The swatch stays that theme's own colour whatever theme is active, so it reads the fixed
    // --swatch-* var rather than the (themed) amber ramp.
    expect(buttons[0]!.attributes('style')).toContain('var(--swatch-amber)')
  })

  it('marks exactly one square as pressed - the active theme, amber by default', async () => {
    const wrapper = await mountSuspended(ThemesForm)
    const pressed = wrapper.findAll('button').filter(b => b.attributes('aria-pressed') === 'true')

    expect(pressed).toHaveLength(1)
    expect(pressed[0]!.attributes('aria-label')).toBe('Amber')
  })

  it('clicking a square applies and persists that theme', async () => {
    const wrapper = await mountSuspended(ThemesForm)
    const violet = wrapper.findAll('button').find(b => b.attributes('aria-label') === 'Violet')!

    await violet.trigger('click')

    expect(document.documentElement.dataset.theme).toBe('violet')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('violet')
    expect(violet.attributes('aria-pressed')).toBe('true')
    // …and the previously-active square gives up the pressed state, so exactly one stays selected.
    const pressed = wrapper.findAll('button').filter(b => b.attributes('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
  })
})
