import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Shell from '../../../components/explore/Shell.vue'
import { useChrome } from '../../../composables/useChrome'
import { usePlayerStore } from '../../../stores/player'

const TRACK = {
  id: 't1',
  title: 'Cool Water',
  artist: 'Marty Robbins',
  album: 'Gunfighter Ballads',
  duration: 176,
  artistSlug: 'marty-robbins',
  releaseImage: null,
  releaseImageUrl: null,
  localReleaseId: null,
}

describe('explore/Shell.vue', () => {
  beforeEach(() => {
    useChrome().show()
  })

  it('collapses the config sliders into a summary once a track is explored', async () => {
    const wrapper = await mountSuspended(Shell)
    const player = usePlayerStore()
    vi.spyOn(player, 'pickExplorerTrack').mockImplementation(async () => {
      player.explorerCurrentTrack = TRACK
    })
    const exploreButton = wrapper.findAll('button').find(b => b.text() === 'Explore')!
    // trigger()'s own tick isn't enough here: the click chains through Config's emit -> Shell's
    // async onExplore -> useExplorer's async explore() -> the mocked pickExplorerTrack, each an
    // extra microtask hop nextTick() alone doesn't wait out. flushPromises drains all of them.
    await exploreButton.trigger('click')
    await flushPromises()
    // Not a role="slider" check: once explorerCurrentTrack is set, ExploreCard renders its own
    // seek bar (also role="slider"), so that alone wouldn't distinguish "config collapsed" from
    // "config still expanded, card now showing too".
    expect(wrapper.text()).not.toContain('I\'m feeling...')
    expect(wrapper.text()).toContain('Change')
  })

  it('entering fullscreen hides the app chrome', async () => {
    const wrapper = await mountSuspended(Shell)
    expect(useChrome().visible.value).toBe(true)
    await wrapper.get('[aria-label="Enter fullscreen"]').trigger('click')
    expect(useChrome().visible.value).toBe(false)
    expect(wrapper.find('[aria-label="Exit fullscreen"]').exists()).toBe(true)
  })

  it('Escape exits fullscreen and restores focus to the element that opened it', async () => {
    const wrapper = await mountSuspended(Shell, { attachTo: document.body })
    const trigger = wrapper.get('[aria-label="Enter fullscreen"]').element as HTMLElement
    trigger.focus()
    await wrapper.get('[aria-label="Enter fullscreen"]').trigger('click')
    expect(useChrome().visible.value).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(useChrome().visible.value).toBe(true)
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('unmounting always restores chrome, even while still in fullscreen', async () => {
    const wrapper = await mountSuspended(Shell)
    await wrapper.get('[aria-label="Enter fullscreen"]').trigger('click')
    expect(useChrome().visible.value).toBe(false)
    wrapper.unmount()
    expect(useChrome().visible.value).toBe(true)
  })
})
