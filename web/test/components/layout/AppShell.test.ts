import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AppShell from '../../../components/layout/AppShell.vue'

describe('layout/AppShell.vue', () => {
  it('renders a skip-to-content link targeting the main landmark', async () => {
    const wrapper = await mountSuspended(AppShell, {
      slots: { default: '<p>Page body</p>' },
      global: {
        stubs: {
          LayoutSidebar: true,
          LayoutSearchBar: true,
          LayoutMobileNav: true,
          LayoutToastHost: true,
          PlayerAudioPlayer: true,
          TerminalOutput: true,
          TerminalProgress: true,
        },
      },
    })
    const skipLink = wrapper.get('a')
    expect(skipLink.text()).toBe('Skip to content')
    expect(skipLink.attributes('href')).toBe('#main-content')
    expect(wrapper.get('main').attributes('id')).toBe('main-content')
  })

  it('renders the default slot inside the main landmark', async () => {
    const wrapper = await mountSuspended(AppShell, {
      slots: { default: '<p>Page body</p>' },
      global: {
        stubs: {
          LayoutSidebar: true,
          LayoutSearchBar: true,
          LayoutMobileNav: true,
          LayoutToastHost: true,
          PlayerAudioPlayer: true,
          TerminalOutput: true,
          TerminalProgress: true,
        },
      },
    })
    expect(wrapper.get('main').text()).toContain('Page body')
  })
})
