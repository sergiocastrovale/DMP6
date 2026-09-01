import type { Tone } from './ui'

export type IssueType ='corrupted' | 'orphans' | 'duplicates' | 'missing' | 'enrichment' | 'duplicate-release' | 'mismatched-release-id'
export type HistoryIssueType = Extract<IssueType, 'corrupted' | 'missing'>
// Types that flow through the /api/issues/[type] patch+queue endpoints (a strict subset of IssueType —
// duplicate-release/mismatched-release-id/enrichment are audit-only, never individually patched/queued).
export type FixableIssueType = Extract<IssueType, 'corrupted' | 'orphans' | 'duplicates' | 'missing'>
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

export interface IssueColumn {
  key: string
  label: string
  sortable?: boolean
  width?: string
  editable?: boolean
  editKey?: string
}

export type EnrichmentField = 'bpm' | 'mood' | 'acousticId' | 'mbRelease' | 'discogs' | 'bandcamp' | 'wikipedia'

export interface EnrichmentFieldConfig {
  label: string
  tone: Tone
  extraClass?: string
  fixable: boolean
  help?: string
}

export interface HistoryFolderGroup {
  folder: string
  items: FixHistoryRow[]
  ids: string[]
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
