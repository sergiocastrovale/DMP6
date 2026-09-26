import { playlistTrackToPlayerTrack } from '~/helpers/playerTrack'
import type { PlaylistDetail } from '~/types/playlist'
import { useGlobalStore } from '~/stores/global'
import { usePlayerStore } from '~/stores/player'

// State and actions behind pages/playlists/[slug].vue: load the playlist, play it, remove a track, delete it.
export const usePlaylistPage = (slug: string) => {
  const router = useRouter()
  const api = useApi()
  const global = useGlobalStore()
  const playerStore = usePlayerStore()

  const loading = ref(true)
  const playlist = ref<PlaylistDetail | null>(null)
  const showDeleteConfirm = ref(false)

  watch(() => playlist.value?.name, (name) => {
    if (name) {
      useTitle('Playlists', name)
    }
  })

  const load = async () => {
    loading.value = true
    try {
      playlist.value = await $fetch<PlaylistDetail>(`/api/playlists/${slug}`)
    }
    catch (e) {
      api.report(e, 'Could not load the playlist')
    }
    finally {
      loading.value = false
    }
  }

  const playAll = () => {
    if (!playlist.value?.tracks.length) { return }
    const tracks = playlist.value.tracks.map(pt => playlistTrackToPlayerTrack(pt.track))
    playerStore.playTrack(tracks[0]!, tracks)
  }

  const removeTrack = async (trackId: string) => {
    if (!playlist.value) { return }
    if (await api.run(() => $fetch<unknown>(`/api/playlists/${slug}/tracks/${trackId}`, { method: 'DELETE' }), 'Could not remove the track')) {
      await load()
    }
  }

  const deletePlaylist = async () => {
    if (!playlist.value) { return }
    showDeleteConfirm.value = false
    const name = playlist.value.name
    if (await api.run(() => $fetch<unknown>(`/api/playlists/${slug}`, { method: 'DELETE' }), `Could not delete "${name}"`)) {
      global.stats.playlists--
      router.push('/playlists')
    }
  }

  onMounted(load)

  return { loading, playlist, showDeleteConfirm, playAll, removeTrack, deletePlaylist }
}
