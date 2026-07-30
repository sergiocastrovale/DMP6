import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AudioPlayer from '../../../components/player/AudioPlayer.vue'
import { usePlayerStore } from '../../../stores/player'

const fetchMock = vi.fn().mockResolvedValue([])
vi.stubGlobal('$fetch', fetchMock)

// mountSuspended reuses the same Nuxt app (and its @pinia/nuxt-installed Pinia instance) across every
// test in this file rather than creating a fresh one per mount, so store state leaks between tests
// unless explicitly reset. Getting the store must also happen AFTER mount (mounting is what leaves
// that app's pinia active) - a bare setActivePinia(createPinia()) beforehand resolves to a different,
// unrelated instance than the one the mounted component actually uses.
let activePlayer: ReturnType<typeof usePlayerStore> | undefined

const mountPlayer = async () => {
  const wrapper = await mountSuspended(AudioPlayer, {
    global: { stubs: { PlaylistAddDialog: true, ToggleFavorite: true, NuxtLink: true } },
  })
  const player = usePlayerStore()
  activePlayer = player
  return { wrapper, player }
}

describe('AudioPlayer.vue', () => {

  beforeEach(() => {
    fetchMock.mockClear()
  })

  afterEach(() => {
    if (activePlayer) {
      activePlayer.currentTrack = null
      activePlayer.isVisible = false
      activePlayer.shuffleMode = 'off'
      activePlayer.duration = 0
      activePlayer.currentTime = 0
    }
  })

  it('renders nothing (v-if) when the player is not visible', async () => {
    const { wrapper } = await mountPlayer()
    expect(wrapper.find('.border-t').exists()).toBe(false)
  })

  it('renders the transport controls once a track is visible', async () => {
    const { wrapper, player } = await mountPlayer()
    player.isVisible = true
    player.currentTrack = { id: 't1', title: 'Song', artist: 'Artist', album: 'A', duration: 200, artistSlug: 'artist', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1' }
    await nextTick()
    expect(wrapper.text()).toContain('Song')
    expect(wrapper.find('[aria-label="Previous track"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Next track"]').exists()).toBe(true)
  })

  it('shows "No track" placeholder when there is no current track', async () => {
    const { wrapper, player } = await mountPlayer()
    player.isVisible = true
    await nextTick()
    expect(wrapper.text()).toContain('No track')
  })

  it('clicking previous/next calls the corresponding player store actions', async () => {
    const { wrapper, player } = await mountPlayer()
    player.isVisible = true
    await nextTick()
    const prevSpy = vi.spyOn(player, 'previous').mockImplementation(() => {})
    const nextSpy = vi.spyOn(player, 'next').mockResolvedValue(undefined)
    await wrapper.find('[aria-label="Previous track"]').trigger('click')
    expect(prevSpy).toHaveBeenCalledOnce()
    await wrapper.find('[aria-label="Next track"]').trigger('click')
    expect(nextSpy).toHaveBeenCalledOnce()
  })

  it('clicking the shuffle button calls cycleShuffleMode', async () => {
    const { wrapper, player } = await mountPlayer()
    player.isVisible = true
    await nextTick()
    const spy = vi.spyOn(player, 'cycleShuffleMode').mockResolvedValue(undefined)
    await wrapper.find('[title^="Shuffle"]').trigger('click')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('shows a shuffle-mode label badge when shuffle is active', async () => {
    const { wrapper, player } = await mountPlayer()
    player.isVisible = true
    player.shuffleMode = 'artist'
    await nextTick()
    expect(wrapper.text()).toContain('Artist')
  })

  it('clicking the progress bar seeks proportionally', async () => {
    const { wrapper, player } = await mountPlayer()
    player.isVisible = true
    player.duration = 200
    await nextTick()
    const seekSpy = vi.spyOn(player, 'seek').mockImplementation(() => {})
    const bar = wrapper.find('.group.relative.h-1\\.5')
    vi.spyOn(bar.element, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    await bar.trigger('click', { clientX: 50 })
    expect(seekSpy).toHaveBeenCalledWith(100) // 50% of 200s duration
  })

  it('dismiss button calls player.dismiss()', async () => {
    const { wrapper, player } = await mountPlayer()
    player.isVisible = true
    await nextTick()
    const spy = vi.spyOn(player, 'dismiss').mockImplementation(() => {})
    await wrapper.find('[title="Dismiss player"]').trigger('click')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('play/pause button reflects isPlaying and toggles playback on click', async () => {
    const { wrapper, player } = await mountPlayer()
    player.isVisible = true
    await nextTick()
    const spy = vi.spyOn(player, 'togglePlay').mockImplementation(() => {})
    const playBtn = wrapper.find('[aria-label="Play"]')
    expect(playBtn.exists()).toBe(true)
    await playBtn.trigger('click')
    expect(spy).toHaveBeenCalledOnce()
  })
})
