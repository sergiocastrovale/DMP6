export interface UnifiedRelease {
  id: string
  title: string
  year: number | null
  type: string
  typeSlug: string
  musicbrainzId: string | null
  status: ReleaseStatus
  image: string | null
  imageUrl: string | null
  trackCount: number
  localTrackCount: number
  isMusicBrainz: boolean
  localReleaseId: string | null
}

export type ReleaseStatus =
  | 'COMPLETE'
  | 'INCOMPLETE'
  | 'EXTRA_TRACKS'
  | 'MISSING'
  | 'UNSYNCABLE'
  | 'UNKNOWN'

export interface ReleaseType {
  id: string
  name: string
  slug: string
}
