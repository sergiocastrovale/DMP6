import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ToggleButton from '../../../components/visualizer/ToggleButton.vue'
import { usePlayerStore } from '../../../stores/player'

const track = { id: 't1', title: 'Track', artist: 'Artist', album: 'Album', duration: 200, artistSlug: 'artist', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1' }

let activePlayer: ReturnType<typeof usePlayerStore> | undefined

const mountToggle = async () => {
  const wrapper = await mountSuspended(ToggleButton)
  const player = usePlayerStore()
  activePlayer = player
  return { wrapper, player }
}

describe('visualizer/ToggleButton.vue', () => {
  afterEach(async () => {
    if (activePlayer) {
      activePlayer.currentTrack = null
    }
    const { close } = useVisualizer()
    close()
    await nextTick()
  })

  it('is labelled for screen readers, since it renders as a bare icon', async () => {
    const { wrapper, player } = await mountToggle()
    player.currentTrack = track as never
    await nextTick()
    expect(wrapper.get('button').attributes('aria-label')).toBe('Visualizer')
  })

  // The player store only creates its HTMLAudioElement on first playback - with no track there is
  // nothing to tap, so the button says why instead of opening onto a black screen.
  it('is disabled with no current track', async () => {
    const { wrapper } = await mountToggle()
    const button = wrapper.get('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toBe('Play something to use the visualizer')
  })

  it('opens the visualizer on click once a track is playing', async () => {
    const { wrapper, player } = await mountToggle()
    player.currentTrack = track as never
    await nextTick()

    const { active } = useVisualizer()
    expect(active.value).toBe(false)

    await wrapper.get('button').trigger('click')

    expect(active.value).toBe(true)
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('true')
  })

  it('closes again on a second click', async () => {
    const { wrapper, player } = await mountToggle()
    player.currentTrack = track as never
    await nextTick()

    await wrapper.get('button').trigger('click')
    await wrapper.get('button').trigger('click')

    expect(useVisualizer().active.value).toBe(false)
  })
})
