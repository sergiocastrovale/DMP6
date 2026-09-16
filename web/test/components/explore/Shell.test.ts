import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Shell from '../../../components/explore/Shell.vue'
import { useChrome } from '../../../composables/useChrome'
import { usePlayerStore } from '../../../stores/player'

// ExploreDidYouKnow fetches on mount whenever a track is playing, which every test below sets up -
// stub it globally so that's a resolved no-op instead of a real network call (same convention as
// test/components/artist/DidYouKnow.test.ts / UsersLive.test.ts).
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.stubGlobal('$fetch', fetchMock)

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
    // configCollapsed reads player.explorerCurrentTrack at setup() time, so a track left over
    // from a previous test would mount the next Shell already-collapsed with no "Explore" button.
    usePlayerStore().explorerCurrentTrack = null
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(null)
  })

  it('renders the "Did you know" widget once a track is explored', async () => {
    fetchMock.mockResolvedValue({ text: 'Some trivia.', sourceUrl: null, release: null, track: null })
    const wrapper = await mountSuspended(Shell)
    const player = usePlayerStore()
    vi.spyOn(player, 'pickExplorerTrack').mockImplementation(async () => {
      player.explorerCurrentTrack = TRACK
    })

    await wrapper.findAll('button').find(b => b.text() === 'Explore')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/tracks/t1/fact')
    expect(wrapper.text()).toContain('Some trivia.')
  })

  it('does not render the "Did you know" widget when nothing is playing', async () => {
    await mountSuspended(Shell)
    expect(fetchMock).not.toHaveBeenCalled()
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

  it('Cancel changes puts the dials back where they were and re-collapses', async () => {
    const wrapper = await mountSuspended(Shell)
    const player = usePlayerStore()
    vi.spyOn(player, 'pickExplorerTrack').mockImplementation(async () => {
      player.explorerCurrentTrack = TRACK
    })

    await wrapper.findAll('button').find(b => b.text() === 'Explore')!.trigger('click')
    await flushPromises()
    const summaryBefore = wrapper.text()

    await wrapper.findAll('button').find(b => b.text() === 'Change')!.trigger('click')
    await wrapper.vm.$nextTick()
    // Move a dial, then back out of it.
    await wrapper.findAll('[role="slider"]')[0]!.trigger('keydown', { key: 'ArrowRight' })
    await wrapper.vm.$nextTick()

    await wrapper.findAll('button').find(b => b.text() === 'Cancel changes')!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('I\'m feeling...')
    expect(wrapper.text()).toContain('Change')
    // The summary line is built from the slider stops, so an unreverted edit would show up here.
    expect(wrapper.text()).toBe(summaryBefore)
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

  it('hides the persistent player bar for the whole visit and restores it on unmount', async () => {
    expect(useChrome().player.value).toBe(true)
    const wrapper = await mountSuspended(Shell)
    expect(useChrome().player.value).toBe(false)
    // Toggling fullscreen off while still on Explore must not bring the bar back.
    await wrapper.get('[aria-label="Enter fullscreen"]').trigger('click')
    await wrapper.get('[aria-label="Exit fullscreen"]').trigger('click')
    expect(useChrome().player.value).toBe(false)
    wrapper.unmount()
    expect(useChrome().player.value).toBe(true)
  })
})
