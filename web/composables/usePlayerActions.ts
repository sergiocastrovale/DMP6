import { usePlayerStore } from '~/stores/player'
import type { UnifiedRelease, ReleaseInfoExtra } from '~/types/release'

// Playlist-menu + release-info state and methods used by every player surface (desktop bar,
// mobile collapsed bar's sheet). Plain refs, not useState - each caller gets its own popover-open
// state so the desktop bar's menu and the mobile sheet's menu never cross-talk.
export const usePlayerActions = () => {
  const player = usePlayerStore()

  const showPlaylistMenu = ref(false)
  const showNewPlaylistDialog = ref(false)
  const playlists = ref<any[]>([])
  const trackPlaylistSlugs = ref<Set<string>>(new Set())

  const showInfoDialog = ref(false)
  const infoRelease = ref<UnifiedRelease | null>(null)
  const infoExtra = ref<ReleaseInfoExtra | null>(null)

  async function openTrackInfo() {
    const localReleaseId = player.currentTrack?.localReleaseId
    if (!localReleaseId) {
      return
    }
    infoRelease.value = null
    infoExtra.value = null
    showInfoDialog.value = true
    try {
      const [release, extra] = await Promise.all([
        $fetch<UnifiedRelease>(`/api/releases/${localReleaseId}`),
        $fetch<ReleaseInfoExtra>(`/api/releases/${localReleaseId}/info`),
      ])
      infoRelease.value = release
      infoExtra.value = extra
    }
    catch { /* ignore */ }
  }

  watch(() => player.currentTrack?.id, () => {
    showInfoDialog.value = false
  })

  async function loadPlaylists() {
    try {
      const [all, slugs] = await Promise.all([
        $fetch<any[]>('/api/playlists'),
        player.currentTrack
          ? $fetch<string[]>(`/api/tracks/${player.currentTrack.id}/playlists`)
          : Promise.resolve([]),
      ])
      playlists.value = all.filter((p: any) => p.type === 'MANUAL')
      trackPlaylistSlugs.value = new Set(slugs)
    }
    catch (error) {
      console.error('Failed to load playlists:', error)
    }
  }

  async function togglePlaylist(playlistSlug: string) {
    if (!player.currentTrack) {
      return
    }
    const isIn = trackPlaylistSlugs.value.has(playlistSlug)
    try {
      if (isIn) {
        await $fetch(`/api/playlists/${playlistSlug}/tracks/${player.currentTrack.id}`, {
          method: 'DELETE',
        })
        trackPlaylistSlugs.value.delete(playlistSlug)
      }
      else {
        await $fetch(`/api/playlists/${playlistSlug}/tracks`, {
          method: 'POST',
          body: { trackId: player.currentTrack.id },
        })
        trackPlaylistSlugs.value.add(playlistSlug)
      }
    }
    catch (error) {
      console.error('Failed to update playlist:', error)
    }
  }

  function openNewPlaylistDialog() {
    showPlaylistMenu.value = false
    showNewPlaylistDialog.value = true
  }

  async function onPlaylistCreated() {
    await loadPlaylists()
  }

  return {
    showPlaylistMenu,
    showNewPlaylistDialog,
    playlists,
    trackPlaylistSlugs,
    showInfoDialog,
    infoRelease,
    infoExtra,
    loadPlaylists,
    togglePlaylist,
    openNewPlaylistDialog,
    onPlaylistCreated,
    openTrackInfo,
  }
}
