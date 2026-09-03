import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import ThemesForm from '../../../components/settings/ThemesForm.vue'
import { themes, THEME_STORAGE_KEY, uiSizes } from '../../../helpers/constants'

describe('settings/ThemesForm.vue', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.size
  })

  it('renders one square per theme, each labelled and previewing its own colour', async () => {
    const wrapper = await mountSuspended(ThemesForm)
    // The size stepper is a role="slider", not a button, so the buttons are the swatches alone.
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
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toMatchObject({ accent: 'violet' })
    expect(violet.attributes('aria-pressed')).toBe('true')
    // …and the previously-active square gives up the pressed state, so exactly one stays selected.
    const pressed = wrapper.findAll('button').filter(b => b.attributes('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
  })
})

describe('settings/ThemesForm.vue: UI size', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.size
  })

  it('renders a stepper spanning every size, starting at the default', async () => {
    const wrapper = await mountSuspended(ThemesForm)
    const slider = wrapper.get('[role="slider"]')

    expect(slider.attributes('aria-valuemin')).toBe('0')
    expect(slider.attributes('aria-valuemax')).toBe(String(uiSizes.length - 1))
    expect(slider.attributes('aria-valuenow')).toBe(String(uiSizes.findIndex(s => s.id === 'default')))
    expect(wrapper.text()).toContain('Default')
  })

  it('stepping right applies the larger scale to <html> and persists it', async () => {
    const wrapper = await mountSuspended(ThemesForm)
    const slider = wrapper.get('[role="slider"]')

    await slider.trigger('keydown', { key: 'ArrowRight' })

    // 'default' is index 2, so one step right is 'lg' (+10%).
    expect(document.documentElement.dataset.size).toBe('lg')
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toMatchObject({ size: 'lg' })
    expect(wrapper.text()).toContain('+10%')
  })

  it('stepping to either end stays inside the scale', async () => {
    const wrapper = await mountSuspended(ThemesForm)
    const slider = wrapper.get('[role="slider"]')

    await slider.trigger('keydown', { key: 'Home' })
    expect(document.documentElement.dataset.size).toBe(uiSizes[0]!.id)

    await slider.trigger('keydown', { key: 'End' })
    expect(document.documentElement.dataset.size).toBe(uiSizes.at(-1)!.id)
  })
})
