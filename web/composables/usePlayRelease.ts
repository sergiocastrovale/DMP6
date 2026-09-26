import { usePlayerStore } from '~/stores/player'
import type { PlayerTrack } from '~/types/player'
import { toPlayerTrack } from '~/helpers/playerTrack'

export const usePlayRelease = () => {
  const player = usePlayerStore()
  const api = useApi()

  const playRelease = async (releaseId: string, artistSlug?: string) => {
    const data = await api.load(() => $fetch<any>(`/api/releases/${releaseId}/tracks`), 'Could not load the release')
    if (!data) { return }
    const playable = data?.tracks?.filter((t: any) => !t.missing) ?? []
    if (!playable.length) { return }
    const context = { artistSlug: artistSlug ?? data.release?.artistSlug, album: data.release?.title, releaseImage: data.release?.image, releaseImageUrl: data.release?.imageUrl }
    const playerTracks: PlayerTrack[] = playable.map((t: any) => toPlayerTrack(t, context))
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
