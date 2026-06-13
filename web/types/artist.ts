import type { ArtistSummary } from './common'

export type RelatedArtist = ArtistSummary

export interface ArtistListItem extends ArtistSummary {
  averageMatchScore: number | null
  totalPlayCount: number
  totalTracks: number
}

export interface Artist extends ArtistListItem {
  musicbrainzId: string | null
  totalFileSize: bigint | number | string
  lastSyncedAt: string | null
  monitored?: boolean
  genres: Genre[]
  urls: ArtistUrl[]
  relatedArtists?: RelatedArtist[]
}

export interface ArtistUrl {
  id: string
  type: string
  url: string
}

export interface Genre {
  id: string
  name: string
}
