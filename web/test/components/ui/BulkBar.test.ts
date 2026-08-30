import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import BulkBar from '../../../components/ui/BulkBar.vue'
import { useTerminalStore } from '../../../stores/terminal'
import { useSettingsStore } from '../../../stores/settings'

describe('ui/BulkBar.vue', () => {
  afterEach(() => {
    useTerminalStore().isOpen = false
    useSettingsStore().showTerminal = false
  })

  it('is hidden when nothing is selected and shown once count > 0', async () => {
    const wrapper = await mountSuspended(BulkBar, { props: { count: 0 } })
    expect(wrapper.find('div').exists()).toBe(false)

    await wrapper.setProps({ count: 3 })
    expect(wrapper.text()).toContain('3 rows selected')
  })

  it('pluralizes the label correctly and honours a custom label', async () => {
    const one = await mountSuspended(BulkBar, { props: { count: 1, label: 'artist' } })
    expect(one.text()).toContain('1 artist selected')

    const many = await mountSuspended(BulkBar, { props: { count: 2, label: 'artist' } })
    expect(many.text()).toContain('2 artists selected')
  })

  it('renders slot content', async () => {
    const wrapper = await mountSuspended(BulkBar, {
      props: { count: 1 },
      slots: { default: '<button class="action">Do it</button>' },
    })
    expect(wrapper.find('.action').exists()).toBe(true)
  })

  it('only reserves space for the terminal drawer when it is both open and shown', async () => {
    const terminal = useTerminalStore()
    const settings = useSettingsStore()

    const wrapper = await mountSuspended(BulkBar, { props: { count: 1 } })
    const bar = () => wrapper.get('.fixed')

    expect(bar().classes()).not.toContain('lg:right-[500px]')

    terminal.isOpen = true
    await wrapper.vm.$nextTick()
    expect(bar().classes()).not.toContain('lg:right-[500px]')

    settings.showTerminal = true
    await wrapper.vm.$nextTick()
    expect(bar().classes()).toContain('lg:right-[500px]')
  })
})
