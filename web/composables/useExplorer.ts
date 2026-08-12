import { usePlayerStore } from '~/stores/player'
import type { PlayerTrack } from '~/types/player'

export const useExplorer = () => {
  const player = usePlayerStore()

  const energy = ref(5)
  const era = ref(5)
  const familiarity = ref(4)
  const sound = ref(4)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const params = computed(() => ({
    energy: energy.value,
    era: era.value,
    familiarity: familiarity.value,
    sound: sound.value,
  }))

  const explore = async () => {
    isLoading.value = true
    error.value = null
    try {
      await player.pickExplorerTrack(params.value)
    }
    catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to find a track'
    }
    finally {
      isLoading.value = false
    }
  }

  const playFromHistory = (track: PlayerTrack) => {
    player.setExplorerTrack(track, params.value)
  }

  return {
    energy,
    era,
    familiarity,
    sound,
    params,
    isLoading,
    error,
    explore,
    playFromHistory,
  }
}
