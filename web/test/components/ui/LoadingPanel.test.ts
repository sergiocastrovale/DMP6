import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import LoadingPanel from '../../../components/ui/LoadingPanel.vue'

describe('ui/LoadingPanel.vue', () => {
  it('exposes percent via the progressbar aria contract', async () => {
    const wrapper = await mountSuspended(LoadingPanel, { props: { percent: 42 } })
    const bar = wrapper.get('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('42')
    expect(bar.attributes('aria-valuemin')).toBe('0')
    expect(bar.attributes('aria-valuemax')).toBe('100')
  })

  it('clamps percent to [0, 100]', async () => {
    const over = await mountSuspended(LoadingPanel, { props: { percent: 150 } })
    expect(over.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100')

    const under = await mountSuspended(LoadingPanel, { props: { percent: -10 } })
    expect(under.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('0')
  })

  it('rounds a fractional percent for display', async () => {
    const wrapper = await mountSuspended(LoadingPanel, { props: { percent: 42.857, label: 'Building' } })
    expect(wrapper.text()).toContain('43%')
  })

  it('renders the label when provided', async () => {
    const wrapper = await mountSuspended(LoadingPanel, { props: { percent: 10, label: 'Syncing' } })
    expect(wrapper.text()).toContain('Syncing')
  })

  it('draws every tone through the shared toneFill map', async () => {
    const accent = await mountSuspended(LoadingPanel, { props: { percent: 10 } })
    expect(accent.find('.bg-amber-400').exists()).toBe(true)

    const info = await mountSuspended(LoadingPanel, { props: { percent: 10, variant: 'info' } })
    expect(info.find('.bg-info').exists()).toBe(true)

    const muted = await mountSuspended(LoadingPanel, { props: { percent: 10, variant: 'muted' } })
    expect(muted.find('.bg-stone-100\\/30').exists()).toBe(true)
  })
})
