export interface Release {
  id: string
  title: string
  releaseType: string | null
  year: number | null
  image: string | null
  imageUrl: string | null
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
  | 'UNSYNCABLE'
  | 'UNKNOWN'

export interface ReleaseType {
  id: string
  name: string
  slug: string
}
