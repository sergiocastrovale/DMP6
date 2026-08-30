import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VolumeControl from '../../../components/player/VolumeControl.vue'
import { usePlayerStore } from '../../../stores/player'

let activePlayer: ReturnType<typeof usePlayerStore> | undefined

const mountVolume = async () => {
  const wrapper = await mountSuspended(VolumeControl)
  const player = usePlayerStore()
  activePlayer = player
  return { wrapper, player }
}

describe('VolumeControl.vue', () => {
  afterEach(() => {
    if (activePlayer) {
      activePlayer.volume = 0.75
      activePlayer.isMuted = false
    }
  })

  it('reflects the current volume as the fill width', async () => {
    const { wrapper, player } = await mountVolume()
    player.volume = 0.5
    await nextTick()
    const track = wrapper.find('[role="slider"]')
    expect(track.attributes('aria-valuenow')).toBe('50')
  })

  it('shows a muted icon and 0 fill when muted', async () => {
    const { wrapper, player } = await mountVolume()
    player.volume = 0.5
    player.isMuted = true
    await nextTick()
    const track = wrapper.find('[role="slider"]')
    expect(track.attributes('aria-valuenow')).toBe('0')
    expect(wrapper.find('[aria-label="Unmute"]').exists()).toBe(true)
  })

  it('clicking the icon toggles mute', async () => {
    const { wrapper, player } = await mountVolume()
    const spy = vi.spyOn(player, 'toggleMute').mockImplementation(() => {})
    await wrapper.find('[aria-label="Mute"]').trigger('click')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('arrow keys adjust volume via setVolume', async () => {
    const { wrapper, player } = await mountVolume()
    player.volume = 0.5
    await nextTick()
    const spy = vi.spyOn(player, 'setVolume').mockImplementation(() => {})
    await wrapper.find('[role="slider"]').trigger('keydown', { key: 'ArrowRight' })
    expect(spy).toHaveBeenCalledWith(0.55)
  })
})
