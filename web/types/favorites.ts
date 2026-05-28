import type { ArtistRef, ReleaseRef, TrackInContext } from './common'

export interface FavoriteRelease {
  id: string
  createdAt: Date
  release: ReleaseRef & { artist: ArtistRef | null }
}

export interface FavoriteTrack {
  id: string
  createdAt: Date
  track: TrackInContext
}

export interface FavoritesResponse {
  releases: FavoriteRelease[]
  tracks: FavoriteTrack[]
  totalReleases: number
  totalTracks: number
  page: number
  pageSize: number
  hasMoreReleases: boolean
  hasMoreTracks: boolean
}
