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

// true = the matching count hit the server-side cap, so the number is "at least this many" (rendered "1000+").
export interface SearchCountsCapped {
  artists: boolean
  releases: boolean
  tracks: boolean
}

export interface SearchResults {
  artists: SearchArtist[]
  releases: SearchRelease[]
  tracks: SearchTrack[]
  counts: SearchCounts
  countsCapped: SearchCountsCapped
}

export interface SearchPage<T> {
  items: T[]
  total: number
  totalCapped?: boolean
  page: number
  hasMore: boolean
}
