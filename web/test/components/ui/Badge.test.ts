import { mountSuspended } from '@nuxt/test-utils/runtime'
import { Star } from 'lucide-vue-next'
import { describe, expect, it } from 'vitest'
import Badge from '../../../components/ui/Badge.vue'

describe('ui/Badge.vue', () => {
  it('renders slot content', async () => {
    const wrapper = await mountSuspended(Badge, { slots: { default: 'high' } })
    expect(wrapper.text()).toContain('high')
  })

  it('defaults to the muted tone', async () => {
    const wrapper = await mountSuspended(Badge)
    expect(wrapper.classes()).toContain('bg-stone-800')
  })

  it('applies the requested tone', async () => {
    const wrapper = await mountSuspended(Badge, { props: { tone: 'success' } })
    expect(wrapper.classes()).toContain('bg-success/15')
  })

  it('uses the compact size by default', async () => {
    const wrapper = await mountSuspended(Badge)
    expect(wrapper.classes()).toContain('px-2')
    expect(wrapper.classes()).toContain('text-xs')
  })

  it('switches to the larger size on request', async () => {
    const wrapper = await mountSuspended(Badge, { props: { size: 'md' } })
    expect(wrapper.classes()).toContain('px-2.5')
    expect(wrapper.classes()).toContain('text-sm')
  })

  it('renders an optional icon', async () => {
    const wrapper = await mountSuspended(Badge, { props: { icon: Star } })
    expect(wrapper.findComponent(Star).exists()).toBe(true)
  })
})
