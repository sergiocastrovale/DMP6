import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExplorer } from '../../composables/useExplorer'
import { usePlayerStore } from '../../stores/player'

vi.stubGlobal('$fetch', vi.fn())

describe('useExplorer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('params reflects the four sliders', () => {
    const explorer = useExplorer()
    explorer.energy.value = 8
    explorer.era.value = 2
    explorer.familiarity.value = 1
    explorer.sound.value = 9
    expect(explorer.params.value).toEqual({ energy: 8, era: 2, familiarity: 1, sound: 9 })
  })

  it('explore delegates to player.pickExplorerTrack with the current params and toggles isLoading', async () => {
    const player = usePlayerStore()
    const spy = vi.spyOn(player, 'pickExplorerTrack').mockResolvedValue(undefined)
    const explorer = useExplorer()
    const promise = explorer.explore()
    expect(explorer.isLoading.value).toBe(true)
    await promise
    expect(explorer.isLoading.value).toBe(false)
    expect(spy).toHaveBeenCalledWith(explorer.params.value)
  })

  it('explore captures a thrown error message', async () => {
    const player = usePlayerStore()
    vi.spyOn(player, 'pickExplorerTrack').mockRejectedValue(new Error('no candidates'))
    const explorer = useExplorer()
    await explorer.explore()
    expect(explorer.error.value).toBe('no candidates')
  })

  it('playFromHistory delegates to player.setExplorerTrack', () => {
    const player = usePlayerStore()
    const spy = vi.spyOn(player, 'setExplorerTrack').mockImplementation(() => {})
    const explorer = useExplorer()
    const track = { id: 't1' } as any
    explorer.playFromHistory(track)
    expect(spy).toHaveBeenCalledWith(track, explorer.params.value)
  })
})
