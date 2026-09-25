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
  // A dissolved box has no LocalRelease of its own: its discs (LocalRelease.boxReleaseId) do. Their ids
  // in medium order, so refresh/delete on the box row act on every disc (docs/sync_decisions.md).
  boxDiscReleaseIds?: string[]
  folderPath: string | null
  coArtists?: { name: string; slug: string }[]
  statusReason?: string | null
  connectedArtistName?: string | null
  downloadState?: string | null
  downloadedReleaseId?: string | null
  downloadPercent?: number | null
  // Distinct MB media on this release (null/1 for a plain album, >1 for a box set) - see
  // MusicBrainzRelease.mediumCount and docs/sync_decisions.md.
  discCount?: number | null
  // Set on a dissolved box disc - a real LocalRelease bound to the standalone album's own
  // MusicBrainzRelease, with provenance back to the box it physically lives in (docs/sync_decisions.md).
  boxParent?: { releaseId: string, title: string, mediumPosition: number, mediumTitle: string | null, mediumCount: number } | null
  // Box sets in the catalogue that reprint this release's whole release group, regardless of whether
  // this artist owns a copy of them - a pure catalogue fact, not provenance (docs/sync_decisions.md).
  alsoPartOf?: AlsoPartOfEntry[]
}

// A box set reprinting a release group. `releaseId` is the box's MusicBrainzRelease id, so a dissolved
// disc can tell its own box apart from the others (a disc is not "also part of" the box it lives in).
export interface AlsoPartOfEntry {
  releaseId?: string
  title: string
  year: number | null
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
  tracks: { id: string }[]
}

export interface LocalReleaseRow {
  id: string
  title: string
  year: number | null
  folderPath: string | null
  image: string | null
  imageUrl: string | null
  matchStatus: string
  statusReason: string | null
  releaseId: string | null
  totalPlayCount: number
  tracks: { id: string }[]
  artists: { artist: { name: string, slug: string } }[]
  // Box-set provenance (docs/sync_decisions.md) - null for an ordinary, non-box-related release.
  mediumPosition: number | null
  boxReleaseId: string | null
  boxMediumPosition: number | null
}

export interface ImageResolver {
  (image: string | null, imageUrl: string | null, kind: 'releases'): { image: string | null, imageUrl: string | null }
}

export interface LocalAndGapCardsResult {
  cards: UnifiedRelease[]
  coveredMbIds: Set<string>
  appearsOnLocal: LocalReleaseRow[]
}
