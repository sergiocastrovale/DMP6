import type { UnifiedRelease } from './release'

export interface Artist {
  id: string
  name: string
  slug: string
  image: string | null
  imageUrl: string | null
  musicbrainzId: string | null
  averageMatchScore: number | null
  totalPlayCount: number
  totalTracks: number
  totalFileSize: bigint | number
  lastSyncedAt: string | null
  genres: Genre[]
  urls: ArtistUrl[]
}

export interface ArtistListItem {
  id: string
  name: string
  slug: string
  image: string | null
  imageUrl: string | null
  averageMatchScore: number | null
  totalPlayCount: number
  totalTracks: number
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

export interface ArtistDetail extends Artist {
  releases: UnifiedRelease[]
  localReleases: LocalReleaseBasic[]
}

export interface LocalReleaseBasic {
  id: string
  title: string
  year: number | null
  releaseId: string | null
}
