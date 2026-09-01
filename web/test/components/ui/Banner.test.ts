import { mountSuspended } from '@nuxt/test-utils/runtime'
import { AlertTriangle } from 'lucide-vue-next'
import { describe, expect, it } from 'vitest'
import Banner from '../../../components/ui/Banner.vue'

describe('ui/Banner.vue', () => {
  it('renders slot content', async () => {
    const wrapper = await mountSuspended(Banner, { props: { tone: 'accent' }, slots: { default: 'Background searching is paused.' } })
    expect(wrapper.text()).toContain('Background searching is paused.')
  })

  it('applies the requested tone', async () => {
    const wrapper = await mountSuspended(Banner, { props: { tone: 'danger' } })
    expect(wrapper.classes()).toContain('border-danger/40')
    expect(wrapper.classes()).toContain('bg-danger/10')
    expect(wrapper.classes()).toContain('text-danger')
  })

  it('renders an optional icon', async () => {
    const wrapper = await mountSuspended(Banner, { props: { tone: 'accent', icon: AlertTriangle } })
    expect(wrapper.findComponent(AlertTriangle).exists()).toBe(true)
  })

  it('centers items by default', async () => {
    const wrapper = await mountSuspended(Banner, { props: { tone: 'accent' } })
    expect(wrapper.classes()).toContain('items-center')
  })

  it('top-aligns items when align=start, for long wrapping text', async () => {
    const wrapper = await mountSuspended(Banner, { props: { tone: 'accent', align: 'start' } })
    expect(wrapper.classes()).toContain('items-start')
  })

  it('renders the actions slot', async () => {
    const wrapper = await mountSuspended(Banner, {
      props: { tone: 'accent' },
      slots: { actions: '<button>Continue</button>' },
    })
    expect(wrapper.text()).toContain('Continue')
  })
})
