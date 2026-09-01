import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Spinner from '../../../components/ui/Spinner.vue'

describe('ui/Spinner.vue', () => {
  it('renders an animated icon with the system stroke width', async () => {
    const wrapper = await mountSuspended(Spinner)
    const svg = wrapper.get('svg')
    expect(svg.classes()).toContain('animate-spin')
    expect(svg.attributes('stroke-width')).toBe('1.6')
  })

  it('defaults to size 20', async () => {
    const wrapper = await mountSuspended(Spinner)
    expect(wrapper.get('svg').attributes('width')).toBe('20')
  })

  it('honours a custom size', async () => {
    const wrapper = await mountSuspended(Spinner, { props: { size: 32 } })
    expect(wrapper.get('svg').attributes('width')).toBe('32')
  })

  it('is hidden from screen readers', async () => {
    const wrapper = await mountSuspended(Spinner)
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true')
  })
})
