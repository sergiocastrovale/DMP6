import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AudioPlayerMobile from '../../../components/player/AudioPlayerMobile.vue'
import { usePlayerStore } from '../../../stores/player'

const fetchMock = vi.fn().mockResolvedValue([])
vi.stubGlobal('$fetch', fetchMock)

let activePlayer: ReturnType<typeof usePlayerStore> | undefined
let activeWrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

const mountBar = async () => {
  const wrapper = await mountSuspended(AudioPlayerMobile, {
    global: {
      stubs: {
        PlaylistAddDialog: true, ToggleFavorite: true, NuxtLink: true, ReleaseInfoDialog: true,
        VisualizerToggleButton: true,
      },
    },
  })
  activeWrapper = wrapper
  const player = usePlayerStore()
  activePlayer = player
  return { wrapper, player }
}

describe('AudioPlayerMobile.vue', () => {
  // Expanding mounts PlayerMobileSheet, which teleports to document.body - clean that up too,
  // or a leftover node leaks into the next test's DOM.
  afterEach(() => {
    activeWrapper?.unmount()
    activeWrapper = undefined
    document.body.innerHTML = ''
    if (activePlayer) {
      activePlayer.currentTrack = null
      activePlayer.isVisible = false
    }
  })

  it('renders nothing (v-if) when the player is not visible', async () => {
    const { wrapper } = await mountBar()
    expect(wrapper.find('[aria-label="Expand player"]').exists()).toBe(false)
  })

  it('renders cover, title, artist and transport once a track is visible', async () => {
    const { wrapper, player } = await mountBar()
    player.isVisible = true
    player.currentTrack = { id: 't1', title: 'Song', artist: 'Artist', album: 'A', duration: 200, artistSlug: 'artist', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1' }
    await nextTick()
    expect(wrapper.text()).toContain('Song')
    expect(wrapper.text()).toContain('Artist')
    expect(wrapper.find('[aria-label="Previous track"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Next track"]').exists()).toBe(true)
  })

  it('does not render a dismiss button or the visualizer toggle at rest - those live in the sheet', async () => {
    const { wrapper, player } = await mountBar()
    player.isVisible = true
    await nextTick()
    expect(wrapper.find('[title="Dismiss player"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'VisualizerToggleButton' }).exists()).toBe(false)
  })

  it('clicking previous/next calls the corresponding player store actions', async () => {
    const { wrapper, player } = await mountBar()
    player.isVisible = true
    await nextTick()
    const prevSpy = vi.spyOn(player, 'previous').mockImplementation(() => {})
    const nextSpy = vi.spyOn(player, 'next').mockResolvedValue(undefined)
    await wrapper.find('[aria-label="Previous track"]').trigger('click')
    expect(prevSpy).toHaveBeenCalledOnce()
    await wrapper.find('[aria-label="Next track"]').trigger('click')
    expect(nextSpy).toHaveBeenCalledOnce()
  })

  it('clicking the full-bleed expand button mounts the sheet and sets aria-expanded', async () => {
    const { wrapper, player } = await mountBar()
    player.isVisible = true
    await nextTick()
    const expandBtn = wrapper.find('[aria-label="Expand player"]')
    expect(expandBtn.attributes('aria-expanded')).toBe('false')
    expect(wrapper.findComponent({ name: 'PlayerMobileSheet' }).exists()).toBe(false)

    await expandBtn.trigger('click')
    expect(expandBtn.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findComponent({ name: 'PlayerMobileSheet' }).exists()).toBe(true)
  })

  it('clicking a transport control does not also expand the sheet', async () => {
    const { wrapper, player } = await mountBar()
    player.isVisible = true
    await nextTick()
    vi.spyOn(player, 'previous').mockImplementation(() => {})
    await wrapper.find('[aria-label="Previous track"]').trigger('click')
    expect(wrapper.findComponent({ name: 'PlayerMobileSheet' }).exists()).toBe(false)
  })

  it('closing the sheet collapses it back', async () => {
    const { wrapper, player } = await mountBar()
    player.isVisible = true
    await nextTick()
    await wrapper.find('[aria-label="Expand player"]').trigger('click')
    expect(wrapper.findComponent({ name: 'PlayerMobileSheet' }).exists()).toBe(true)

    await wrapper.findComponent({ name: 'PlayerMobileSheet' }).vm.$emit('close')
    await nextTick()
    expect(wrapper.findComponent({ name: 'PlayerMobileSheet' }).exists()).toBe(false)
  })
})
