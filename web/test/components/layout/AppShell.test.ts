import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick, onBeforeUnmount } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AppShell from '../../../components/layout/AppShell.vue'

const STUBS = {
  LayoutSidebar: true,
  LayoutSearchBar: true,
  LayoutMobileNav: true,
  LayoutToastHost: true,
  PlayerAudioPlayer: true,
  TerminalOutput: true,
  TerminalProgress: true,
}

describe('layout/AppShell.vue', () => {
  // useChrome's state is shared (Nuxt useState), so make sure it's back to the default before
  // and after every test regardless of what a chrome-hidden test below does.
  afterEach(() => {
    useChrome().show()
  })

  it('renders a skip-to-content link targeting the main landmark', async () => {
    const wrapper = await mountSuspended(AppShell, {
      slots: { default: '<p>Page body</p>' },
      global: { stubs: STUBS },
    })
    const skipLink = wrapper.get('a')
    expect(skipLink.text()).toBe('Skip to content')
    expect(skipLink.attributes('href')).toBe('#main-content')
    expect(wrapper.get('main').attributes('id')).toBe('main-content')
  })

  it('renders the default slot inside the main landmark', async () => {
    const wrapper = await mountSuspended(AppShell, {
      slots: { default: '<p>Page body</p>' },
      global: { stubs: STUBS },
    })
    expect(wrapper.get('main').text()).toContain('Page body')
  })

  it('renders the sidebar and search bar when chrome is visible', async () => {
    const wrapper = await mountSuspended(AppShell, {
      slots: { default: '<p>Page body</p>' },
      global: { stubs: STUBS },
    })
    expect(wrapper.findComponent({ name: 'LayoutSidebar' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'LayoutSearchBar' }).exists()).toBe(true)
  })

  it('drops the sidebar, search bar, mobile nav and player bar when chrome is hidden', async () => {
    useChrome().hide()
    const wrapper = await mountSuspended(AppShell, {
      slots: { default: '<p>Page body</p>' },
      global: { stubs: STUBS },
    })
    expect(wrapper.findComponent({ name: 'LayoutSidebar' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'LayoutSearchBar' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'LayoutMobileNav' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'PlayerAudioPlayer' }).exists()).toBe(false)
    expect(wrapper.get('main').attributes('id')).toBe('main-content')
    expect(wrapper.get('main').text()).toContain('Page body')
  })

  it('toggling chrome visibility does not unmount the slotted page (cinema mode must not lose page state)', async () => {
    let unmountCount = 0
    const StatefulChild = defineComponent({
      setup() {
        onBeforeUnmount(() => { unmountCount++ })
        return () => null
      },
    })
    await mountSuspended(AppShell, {
      slots: { default: () => h(StatefulChild) },
      global: { stubs: STUBS },
    })
    useChrome().hide()
    await nextTick()
    useChrome().show()
    await nextTick()
    expect(unmountCount).toBe(0)
  })
})
