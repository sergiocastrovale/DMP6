export interface PlayerTrack {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artistSlug: string | null
  releaseImage: string | null
  releaseImageUrl: string | null
  localReleaseId: string | null
}

export type ShuffleMode = 'off' | 'release' | 'artist' | 'catalogue'

export interface PlayerState {
  currentTrack: PlayerTrack | null
  queue: PlayerTrack[]
  originalQueue: PlayerTrack[]
  isPlaying: boolean
  volume: number
  isMuted: boolean
  currentTime: number
  duration: number
  isVisible: boolean
  shuffleMode: ShuffleMode
  history: string[]
}

export interface PersistedPlayerState {
  trackId: string | null
  currentTime: number
  volume: number
  isMuted: boolean
  shuffleMode: ShuffleMode
  queue: PlayerTrack[]
  originalQueue: PlayerTrack[]
}
