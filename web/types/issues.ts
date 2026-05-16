export type IssueStatus = 'DETECTED' | 'PENDING' | 'PENDING_REVERT' | 'RESOLVED' | 'FAILED'
export type IssueType = 'corrupted' | 'unsplit' | 'orphans' | 'duplicates' | 'missing' | 'enrichment'
export type Confidence = 'high' | 'medium' | 'low'

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

export interface IssueCorruptedTpe2Row {
  id: string
  status: IssueStatus
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

export interface IssueUnsplitArtistRow {
  id: string
  status: IssueStatus
  separator: string
  proposedParts: string[]
  artist: { id: string; name: string; slug: string; totalTracks: number }
}

export interface IssueOrphanArtistRow {
  id: string
  status: IssueStatus
  reason: string
  artist: { id: string; name: string; slug: string; createdAt: string; musicbrainzId: string | null }
}

export interface IssueDuplicateArtistRow {
  id: string
  status: IssueStatus
  artistA: { id: string; name: string; slug: string; totalTracks: number }
  artistB: { id: string; name: string; slug: string; totalTracks: number }
}

export interface IssueMissingMetadataRow {
  id: string
  status: IssueStatus
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

export interface IssueEnrichmentGapRow {
  id: string
  status: IssueStatus
  missingFields: EnrichmentField[]
  artist: { name: string; slug: string } | null
  localRelease: { id: string; title: string; year: number | null }
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
