import type { ArtistRef, ReleaseRef } from './common'

export interface Release extends ReleaseRef {
  releaseType: string | null
  genre: string | null
  artist: ArtistRef | null
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
  bundleParentReleaseId?: string | null
  folderPath: string | null
  coArtists?: { name: string; slug: string }[]
  statusReason?: string | null
  connectedArtistName?: string | null
  downloadState?: string | null
  downloadedReleaseId?: string | null
  downloadPercent?: number | null
  // Distinct MB media on this release (null/1 for a plain album, >1 for a box set) - see
  // MusicBrainzRelease.mediumCount and docs/box_sets.md.
  discCount?: number | null
  // Set only on a virtual "this disc IS that standalone album" card (see buildBoxEditionCards) -
  // never on a real LocalRelease/MusicBrainzRelease-backed card. Lets the album's own edition group
  // show the box disc as an extra edition without a second LocalRelease row existing for it.
  boxParent?: { releaseId: string, title: string, mediumPosition: number, mediumTitle: string | null } | null
}

export type ReleaseStatus =
  | 'COMPLETE'
  | 'INCOMPLETE'
  | 'EXTRA_TRACKS'
  | 'MISSING_TRACKS'
  | 'MISSING'
  | 'UNKNOWN'
  | 'UNMATCHED'

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

// Raw DB row shapes consumed by server/utils/releaseAggregation.ts to build UnifiedRelease cards.
export interface MbReleaseRow {
  id: string
  title: string
  year: number | null
  musicbrainzId: string
  releaseGroupId: string | null
  disambiguation: string | null
  editionLabel: string | null
  releaseDate: string | null
  packaging: string | null
  country: string | null
  format: string | null
  status: string
  statusReason: string | null
  mediumCount: number
  media: { position: number, title: string | null, equivalentReleaseId: string | null, equivalentReleaseGroupId: string | null }[]
  type: { name: string, slug: string }
  tracks: { id: string, localTracks?: { localReleaseId: string | null }[] }[]
}

export interface LocalReleaseRow {
  id: string
  title: string
  year: number | null
  folderPath: string | null
  image: string | null
  imageUrl: string | null
  matchStatus: string
  releaseId: string | null
  totalPlayCount: number
  tracks: { id: string }[]
  artists: { artist: { name: string, slug: string } }[]
}

export interface ImageResolver {
  (image: string | null, imageUrl: string | null, kind: 'releases'): { image: string | null, imageUrl: string | null }
}

export interface LocalAndGapCardsResult {
  cards: UnifiedRelease[]
  coveredMbIds: Set<string>
  appearsOnLocal: LocalReleaseRow[]
}
