import { mountSuspended } from '@nuxt/test-utils/runtime'
import { Heart } from 'lucide-vue-next'
import { describe, expect, it, vi } from 'vitest'
import UiButton from '../../../components/ui/Button.vue'

describe('ui/Button.vue', () => {
  it('renders the default slot as its label', async () => {
    const wrapper = await mountSuspended(UiButton, { slots: { default: 'Save' } })
    expect(wrapper.text()).toBe('Save')
  })

  it('disables the button and blocks clicks while loading', async () => {
    const onClick = vi.fn()
    const wrapper = await mountSuspended(UiButton, {
      props: { loading: true, onClick },
      slots: { default: 'Save' },
    })
    const button = wrapper.get('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
    await button.trigger('click')
    // A native `disabled` button never dispatches `click` at all - this is the browser
    // enforcing it, not application code, but it's the actual contract callers rely on.
    expect(onClick).not.toHaveBeenCalled()
  })

  it('disables the button when the disabled prop is set', async () => {
    const wrapper = await mountSuspended(UiButton, {
      props: { disabled: true },
      slots: { default: 'Save' },
    })
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  it('is clickable and forwards click when neither disabled nor loading', async () => {
    const onClick = vi.fn()
    const wrapper = await mountSuspended(UiButton, { props: { onClick }, slots: { default: 'Save' } })
    await wrapper.get('button').trigger('click')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('exposes aria-pressed only when `on` is set, for toggle-style buttons', async () => {
    const off = await mountSuspended(UiButton, { props: { on: false }, slots: { default: 'Filter' } })
    expect(off.get('button').attributes('aria-pressed')).toBeUndefined()
    const on = await mountSuspended(UiButton, { props: { on: true }, slots: { default: 'Filter' } })
    expect(on.get('button').attributes('aria-pressed')).toBe('true')
  })

  it('renders as a NuxtLink when `to` is provided, with no native disabled attribute', async () => {
    const wrapper = await mountSuspended(UiButton, {
      props: { to: '/browse' },
      slots: { default: 'Browse' },
    })
    expect(wrapper.get('a').attributes('disabled')).toBeUndefined()
  })

  it('hides the default slot in icon-only mode and still requires an aria-label for a11y', async () => {
    const wrapper = await mountSuspended(UiButton, {
      props: { iconOnly: true, icon: Heart, ariaLabel: 'Favourite' },
      slots: { default: 'Favourite' },
    })
    expect(wrapper.text()).toBe('')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Favourite')
  })

  it('renders every variant without throwing', async () => {
    const variants = ['primary', 'secondary', 'quiet', 'danger', 'ghost'] as const
    for (const variant of variants) {
      const wrapper = await mountSuspended(UiButton, { props: { variant }, slots: { default: 'Go' } })
      expect(wrapper.get('button').classes().length).toBeGreaterThan(0)
    }
  })
})
