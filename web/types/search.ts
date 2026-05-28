import type { ArtistSummary, TrackInContext } from './common'
import type { Release } from './release'

export type SearchArtist = ArtistSummary

export type SearchRelease = Omit<Release, 'genre'>

export type SearchTrack = TrackInContext

export interface SearchResults {
  artists: SearchArtist[]
  releases: SearchRelease[]
  tracks: SearchTrack[]
}
