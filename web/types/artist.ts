import type { ArtistSummary } from './common'

export type RelatedArtist = ArtistSummary

export interface ArtistListItem extends ArtistSummary {
  completeness: number | null
  totalPlayCount: number
  totalTracks: number
  releaseCount?: number
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

export interface ArtistReleaseLink {
  artistId: string
  localRelease: { id: string }
}

export interface ReleaseStatsResult {
  releaseCount: number
}

export interface CatalogueCounts {
  total: number
  albums: number
  eps: number
  singles: number
}

export interface MonitoringArtistRow {
  id: string
  name: string
  slug: string
  monitored: boolean
  missingReleases: number
  totalReleases: number
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
