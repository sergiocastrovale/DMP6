import type { Track } from '~/types/track'
import { useGlobalStore } from '~/stores/global'

// The hearts on a track list: seeded from the tracks themselves (`isFavorite`, set per user by the tracks endpoints) and
// edited locally by a toggle, so the two never disagree for long.
export const useTrackFavorites = (tracks: () => Track[]) => {
  const global = useGlobalStore()
  const api = useApi()
  const favoriteTracks = ref<Set<string>>(new Set())

  // Re-seeded whenever the list is replaced.
  watch(tracks, (list) => {
    for (const t of list) {
      if (t.isFavorite === undefined) { continue }
      if (t.isFavorite) { favoriteTracks.value.add(t.id) }
      else { favoriteTracks.value.delete(t.id) }
    }
  }, { immediate: true })

  const toggleFavorite = async (trackId: string) => {
    const isFavorite = favoriteTracks.value.has(trackId)
    if (!await api.run(() => $fetch<unknown>(`/api/favorites/tracks/${trackId}`, { method: isFavorite ? 'DELETE' : 'POST' }), 'Could not update the favorite')) {
      return
    }
    if (isFavorite) {
      favoriteTracks.value.delete(trackId)
      global.stats.favorites--
    }
    else {
      favoriteTracks.value.add(trackId)
      global.stats.favorites++
    }
  }

  return { favoriteTracks, toggleFavorite }
}
