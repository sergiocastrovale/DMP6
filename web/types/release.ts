export interface Release {
  id: string
  title: string
  releaseType: string | null
  year: number | null
  image: string | null
  imageUrl: string | null
  genre: string | null
  artist: {
    id: string
    name: string
    slug: string
  } | null
}
export interface UnifiedRelease {
  id: string
  title: string
  year: number | null
  type: string
  typeSlug: string
  mbReleaseRowId: string | null
  musicbrainzId: string | null
  releaseGroupId: string | null
  disambiguation: string | null
  editionLabel: string | null
  releaseDate: string | null
  packaging: string | null
  country: string | null
  format: string | null
  status: ReleaseStatus
  image: string | null
  imageUrl: string | null
  trackCount: number
  totalPlayCount: number
  localTrackCount: number
  isMusicBrainz: boolean
  hasLocal: boolean
  localReleaseId: string | null
  folderPath: string | null
  coArtists?: { name: string; slug: string }[]
  statusReason?: string | null
}

export type ReleaseStatus =
  | 'COMPLETE'
  | 'INCOMPLETE'
  | 'EXTRA_TRACKS'
  | 'MISSING_TRACKS'
  | 'MISSING'
  | 'UNKNOWN'
  | 'UNMATCHED'

export interface ReleaseType {
  id: string
  name: string
  slug: string
}

export interface ReleaseGroup {
  key: string
  releases: UnifiedRelease[]
  primary: UnifiedRelease
  totalTracks: number
  totalLocalTracks: number
  totalPlayCount: number
  earliest: string
}

export interface ReleaseInfoExtra {
  genres: string[]
  bpm: string | null
  originalReleaseDate: string | null
  country: string | null
  label: string | null
  isrc: string | null
  people: Record<string, string[]>
}
