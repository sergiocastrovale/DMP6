import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick, onBeforeUnmount } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AppShell from '../../../components/layout/AppShell.vue'
import { usePlayerStore } from '../../../stores/player'

const STUBS = {
  LayoutSidebar: true,
  LayoutSearchBar: true,
  LayoutMobileNav: true,
  LayoutToastHost: true,
  PlayerAudioPlayer: true,
  TerminalOutput: true,
  TerminalProgress: true,
  VisualizerOverlay: true,
}

const track = { id: 't1', title: 'Track', artist: 'Artist', album: 'Album', duration: 200, artistSlug: 'artist', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1' }

describe('layout/AppShell.vue', () => {
  // useChrome's state is shared (Nuxt useState), so make sure it's back to the default before
  // and after every test regardless of what a chrome-hidden test below does.
  afterEach(() => {
    useChrome().show()
    useVisualizer().close()
    usePlayerStore().currentTrack = null
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

  it('mounts the visualizer overlay outside the chrome block, so it survives cinema mode', async () => {
    useChrome().hide()
    const wrapper = await mountSuspended(AppShell, {
      slots: { default: '<p>Page body</p>' },
      global: { stubs: STUBS },
    })
    expect(wrapper.findComponent({ name: 'VisualizerOverlay' }).exists()).toBe(true)
  })

  describe('the global "v" shortcut', () => {
    const press = (key: string, target?: HTMLElement) => {
      const event = new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true })
      ;(target ?? document.body).dispatchEvent(event)
      return event
    }

    const mountShell = async () => {
      await mountSuspended(AppShell, {
        slots: { default: '<p>Page body</p>' },
        global: { stubs: STUBS },
      })
      usePlayerStore().currentTrack = track as never
      await nextTick()
    }

    it('toggles the visualizer', async () => {
      await mountShell()

      press('v')
      expect(useVisualizer().active.value).toBe(true)

      press('v')
      expect(useVisualizer().active.value).toBe(false)
    })

    it('does nothing with no track playing - there is no audio element to tap yet', async () => {
      await mountSuspended(AppShell, {
        slots: { default: '<p>Page body</p>' },
        global: { stubs: STUBS },
      })
      usePlayerStore().currentTrack = null
      await nextTick()

      press('v')

      expect(useVisualizer().active.value).toBe(false)
    })

    it('stays out of the way while the user is typing', async () => {
      await mountShell()
      const input = document.createElement('input')
      document.body.appendChild(input)

      press('v', input)

      expect(useVisualizer().active.value).toBe(false)
      input.remove()
    })
  })
})
