import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Skeleton from '../../../components/ui/Skeleton.vue'

describe('ui/Skeleton.vue', () => {
  it('pulses by default at rect shape', async () => {
    const wrapper = await mountSuspended(Skeleton)
    expect(wrapper.classes()).toContain('animate-pulse')
    expect(wrapper.classes()).toContain('rounded')
  })

  it('applies custom width/height classes', async () => {
    const wrapper = await mountSuspended(Skeleton, { props: { w: 'w-32', h: 'h-3' } })
    expect(wrapper.classes()).toContain('w-32')
    expect(wrapper.classes()).toContain('h-3')
  })

  it('renders a pill shape', async () => {
    const wrapper = await mountSuspended(Skeleton, { props: { shape: 'pill' } })
    expect(wrapper.classes()).toContain('rounded-full')
  })

  it('renders a tile shape sized by width alone, ignoring h', async () => {
    const wrapper = await mountSuspended(Skeleton, { props: { shape: 'tile', w: 'w-full', h: 'h-10' } })
    expect(wrapper.classes()).toContain('aspect-square')
    expect(wrapper.classes()).toContain('rounded-lg')
    expect(wrapper.classes()).not.toContain('h-10')
  })
})
