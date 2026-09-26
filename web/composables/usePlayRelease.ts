import { usePlayerStore } from '~/stores/player'
import type { PlayerTrack } from '~/types/player'

export const usePlayRelease = () => {
  const player = usePlayerStore()
  const api = useApi()

  const playRelease = async (releaseId: string, artistSlug?: string) => {
    const data = await api.load(() => $fetch<any>(`/api/releases/${releaseId}/tracks`), 'Could not load the release')
    if (!data) { return }
    const playable = data?.tracks?.filter((t: any) => !t.missing) ?? []
    if (!playable.length) { return }
    const playerTracks: PlayerTrack[] = playable.map((t: any) => ({
      id: t.id,
      title: t.title || 'Unknown',
      artist: t.artist || 'Unknown',
      album: t.album || data.release?.title || '',
      duration: t.duration || 0,
      artistSlug: artistSlug ?? data.release?.artistSlug ?? null,
      releaseImage: data.release?.image || null,
      releaseImageUrl: data.release?.imageUrl || null,
      localReleaseId: t.localReleaseId,
    }))
    player.setQueue(playerTracks, playerTracks[0])
  }

  const isCurrentRelease = (releaseId: string) =>
    player.currentTrack?.localReleaseId === releaseId

  const isReleasePlaying = (releaseId: string) =>
    player.isPlaying && isCurrentRelease(releaseId)

  const toggleOrPlay = async (releaseId: string, artistSlug?: string) => {
    if (isCurrentRelease(releaseId)) {
      player.togglePlay()
    } else {
      await playRelease(releaseId, artistSlug)
    }
  }

  return { playRelease, isCurrentRelease, isReleasePlaying, toggleOrPlay }
}
