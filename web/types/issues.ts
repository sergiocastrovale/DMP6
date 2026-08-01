import type { ArtistRef } from './common'

export type IssueStatus = 'DETECTED' | 'PENDING' | 'PENDING_REVERT' | 'RESOLVED' | 'FAILED'
export type IssueType = 'corrupted' | 'unsplit' | 'orphans' | 'duplicates' | 'missing' | 'enrichment' | 'duplicate-release' | 'mismatched-release-id'
export type HistoryIssueType = Extract<IssueType, 'corrupted' | 'unsplit' | 'missing'>
export type Confidence = 'high' | 'medium' | 'low'

interface IssueRowBase {
  id: string
  status: IssueStatus
}

export interface AuditRun {
  id: string
  startedAt: string
  finishedAt: string | null
  counts: Record<string, number> | null
}

export interface IssueSummary {
  lastAudit: AuditRun | null
  counts: Record<IssueType, number>
}

export interface IssueCorruptedTPE2Row extends IssueRowBase {
  currentValue: string
  proposedValue: string
  confidence: Confidence
  track: {
    id: string
    filePath: string
    title: string | null
    album: string | null
    localRelease: { artists: { artist: { name: string; slug: string } }[] } | null
  }
}

export interface IssueUnsplitArtistRow extends IssueRowBase {
  separator: string
  proposedParts: string[]
  artist: ArtistRef & { totalTracks: number }
}

export interface IssueOrphanArtistRow extends IssueRowBase {
  reason: string
  artist: ArtistRef & { createdAt: string; musicbrainzId: string | null }
}

export interface IssueDuplicateArtistRow extends IssueRowBase {
  artistA: ArtistRef & { totalTracks: number }
  artistB: ArtistRef & { totalTracks: number }
}

export interface IssueMissingMetadataRow extends IssueRowBase {
  missingFields: string[]
  proposedValues: Record<string, unknown> | null
  track: { id: string; filePath: string; title: string | null; album: string | null; artist: string | null }
}

export interface IssueColumn {
  key: string
  label: string
  sortable?: boolean
  width?: string
  editable?: boolean
  editKey?: string
}

export type EnrichmentField = 'bpm' | 'mood' | 'acousticId' | 'mbRelease' | 'discogs' | 'bandcamp' | 'wikipedia'

export interface IssueEnrichmentGapRow extends IssueRowBase {
  missingFields: EnrichmentField[]
  artist: { name: string; slug: string } | null
  localRelease: { id: string; title: string; year: number | null }
}

interface ReleasePairRef {
  id: string
  title: string
  year: number | null
  totalDuration: number | null
  folderPath: string | null
  trackCount: number
  artist: { name: string; slug: string } | null
  release?: { title: string } | null
}

export interface IssueDuplicateReleaseRow extends IssueRowBase {
  releaseA: ReleasePairRef
  releaseB: ReleasePairRef
}

export interface IssueMismatchedReleaseIdRow extends IssueRowBase {
  releaseA: ReleasePairRef
  releaseB: ReleasePairRef
}

export interface FixHistoryRow {
  id: string
  issueType: string
  issueId: string
  filePath: string
  previousState: Record<string, unknown>
  appliedState: Record<string, unknown>
  appliedAt: string
  revertedAt: string | null
}
