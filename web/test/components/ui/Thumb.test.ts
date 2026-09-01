import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Thumb from '../../../components/ui/Thumb.vue'

describe('ui/Thumb.vue', () => {
  it('renders slot content', async () => {
    const wrapper = await mountSuspended(Thumb, { slots: { default: '<img alt="cover">' } })
    expect(wrapper.find('img').exists()).toBe(true)
  })

  it('defaults to the full-size tile shape', async () => {
    const wrapper = await mountSuspended(Thumb)
    expect(wrapper.classes()).toContain('aspect-square')
    expect(wrapper.classes()).toContain('rounded-lg')
  })

  it('uses the compact row-avatar shape for size=sm', async () => {
    const wrapper = await mountSuspended(Thumb, { props: { size: 'sm' } })
    expect(wrapper.classes()).toContain('size-10')
    expect(wrapper.classes()).toContain('rounded-md')
  })
})
