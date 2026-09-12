import type { ArtistSummary, TrackInContext } from './common'
import type { Release } from './release'

export interface SearchArtist extends ArtistSummary {
  genres: string[]
}

export type SearchRelease = Omit<Release, 'genre'>

export type SearchTrack = TrackInContext

export interface SearchCounts {
  artists: number
  releases: number
  tracks: number
}

export interface SearchResults {
  artists: SearchArtist[]
  releases: SearchRelease[]
  tracks: SearchTrack[]
  counts: SearchCounts
}

export interface SearchPage<T> {
  items: T[]
  total: number
  page: number
  hasMore: boolean
}
