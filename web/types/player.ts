export interface MediaSessionControls {
  isPlaying: () => boolean
  currentTime: () => number
  duration: () => number
  play: () => void
  pause: () => void
  next: () => void
  previous: () => void
  seek: (time: number) => void
}

export interface MediaSessionTrackMeta {
  title: string
  artist: string
  album: string
  artwork: string | null
}

export type MediaSessionActionDetails = { seekTime?: number, seekOffset?: number }

export interface ForegroundServicePlugin {
  start: (options?: { title?: string }) => Promise<void>
  stop: () => Promise<void>
}

export interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  Plugins?: { ForegroundService?: ForegroundServicePlugin }
}

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
  // Only the explore endpoint fills this in (its history rows show "artist · year"); every other
  // queue source leaves it undefined, so treat it as optional everywhere it is read.
  year?: number | null
}

export type ShuffleMode = 'off' | 'release' | 'artist' | 'catalogue' | 'explorer'

export interface ExploreParams {
  energy: number
  era: number
  familiarity: number
  sound: number
}

export interface EnergyConfig {
  bpmMin: number
  bpmMax: number
  moods: Partial<Record<string, number>>
}

export interface ExploreGenreSignals {
  energy: number | null // 0-100
  acoustic: number | null // 0-100 (0=acoustic, 100=electronic)
}

export interface TrackCandidate {
  id: string
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  year: number | null
  genre: string | null
  playCount: number
  lastPlayedAt: Date | null
  metadata: Record<string, unknown> | null
  localReleaseId: string | null
  localRelease: {
    image: string | null
    imageUrl: string | null
    artists: { artist: { slug: string } }[]
  } | null
}

export interface ScoredTrack {
  track: TrackCandidate
  score: number
}

export interface CachedPool {
  candidates: TrackCandidate[]
  createdAt: number
}

export interface PersistedPlayerState {
  trackId: string | null
  currentTime: number
  volume: number
  isMuted: boolean
  shuffleMode: ShuffleMode
  queue: PlayerTrack[]
  originalQueue: PlayerTrack[]
  explorerParams: ExploreParams | null
}
