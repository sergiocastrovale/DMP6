import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Hud from '../../../components/visualizer/Hud.vue'
import { usePlayerStore } from '../../../stores/player'
import { visualizerPresets } from '../../../helpers/constants'

const track = { id: 't1', title: 'Sixteen Tons', artist: 'Tennessee Ernie Ford', album: 'Capitol Collectors', duration: 200, artistSlug: 'tennessee-ernie-ford', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1' }

let activePlayer: ReturnType<typeof usePlayerStore> | undefined

const mountHud = async (visible = true) => {
  const wrapper = await mountSuspended(Hud, { props: { visible } })
  const player = usePlayerStore()
  player.currentTrack = track as never
  activePlayer = player
  await nextTick()
  return { wrapper, player }
}

describe('visualizer/Hud.vue', () => {
  afterEach(() => {
    if (activePlayer) {
      activePlayer.currentTrack = null
    }
  })

  it('shows what is playing', async () => {
    const { wrapper } = await mountHud()
    expect(wrapper.text()).toContain('Sixteen Tons')
    expect(wrapper.text()).toContain('Tennessee Ernie Ford')
    expect(wrapper.text()).toContain('Capitol Collectors')
  })

  it('offers every preset and marks the active one', async () => {
    const { wrapper } = await mountHud()
    const { preset, setPreset } = useVisualizer()
    setPreset('buddhabrot')
    await nextTick()

    const buttons = wrapper.findAll('[aria-pressed]')
    expect(buttons.map(b => b.text())).toEqual(visualizerPresets.map(p => p.label))
    expect(buttons.filter(b => b.attributes('aria-pressed') === 'true').map(b => b.text()))
      .toEqual(['Buddhabrot'])
    expect(preset.value).toBe('buddhabrot')
  })

  it('switches preset on click', async () => {
    const { wrapper } = await mountHud()
    const { preset, setPreset } = useVisualizer()
    setPreset('chaos')
    await nextTick()

    await wrapper.findAll('[aria-pressed]').find(b => b.text() === 'Fractal')!.trigger('click')

    expect(preset.value).toBe('fractal')
  })

  it('drives the transport from the same player store as the bar', async () => {
    const { wrapper, player } = await mountHud()
    const next = vi.spyOn(player, 'next').mockResolvedValue(undefined)

    await wrapper.get('[aria-label="Next track"]').trigger('click')

    expect(next).toHaveBeenCalledOnce()
  })

  // Faded, never unmounted: dropping the DOM would lose the seek bar's identity (and any in-flight
  // pointer capture) every time the idle timer fired.
  it('stays mounted but inert when hidden', async () => {
    const { wrapper } = await mountHud(false)
    const hud = wrapper.get('[data-testid="visualizer-hud"]')
    expect(hud.classes()).toContain('opacity-0')
    expect(hud.classes()).toContain('pointer-events-none')
    expect(wrapper.text()).toContain('Sixteen Tons')
  })
})
