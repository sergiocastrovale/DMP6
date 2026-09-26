import type { IssueColumn, IssueType } from '~/types/issues'

// What the issues pages show for each issue type: its table columns, labels and descriptions, and how a row's folder
// and fix history are read.

export const REVERTABLE_ISSUE_TYPES: IssueType[] = ['corrupted', 'missing']

// Types that are audit-only: listed and counted, never fixed from the UI.
export const AUDIT_ONLY_ISSUE_TYPES: IssueType[] = ['enrichment', 'duplicate-release', 'mismatched-release-id']

// `canFix` makes the corrupted-value proposal editable.
export const issueColumns = (type: IssueType, canFix: boolean): IssueColumn[] => {
  switch (type) {
    case 'corrupted': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'currentValue', label: 'Current Value', sortable: true },
      { key: 'proposedValue', label: 'Proposed Fix', sortable: false, editable: canFix, editKey: 'proposedValue' },
      { key: 'confidence', label: 'Confidence', sortable: true },
      { key: 'folder', label: 'Folder', sortable: false },
    ]
    case 'orphans': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'reason', label: 'Reason', sortable: true },
      { key: 'artist.createdAt', label: 'Created', sortable: false },
      { key: 'artist.musicbrainzId', label: 'MB Synced', sortable: false },
    ]
    case 'duplicates': return [
      { key: 'artistA.name', label: 'Keep (A)', sortable: false },
      { key: 'artistA.totalTracks', label: 'A Tracks', sortable: false, width: 'w-20' },
      { key: 'artistB.name', label: 'Merge (B)', sortable: false },
      { key: 'artistB.totalTracks', label: 'B Tracks', sortable: false, width: 'w-20' },
    ]
    case 'missing': return [
      { key: 'track.title', label: 'Title', sortable: false },
      { key: 'track.artist', label: 'Artist', sortable: false },
      { key: 'track.album', label: 'Album', sortable: false },
      { key: 'missingFields', label: 'Missing', sortable: false },
      { key: 'proposedValues', label: 'Proposed', sortable: false },
      { key: 'folder', label: 'Folder', sortable: false },
    ]
    case 'enrichment': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'localRelease.title', label: 'Release', sortable: true },
      { key: 'localRelease.year', label: 'Year', sortable: true, width: 'w-16' },
      { key: 'missingFields', label: 'Missing', sortable: false },
      { key: 'folder', label: 'Folder', sortable: false },
      { key: '_resync', label: '', sortable: false, width: 'w-24' },
    ]
    case 'duplicate-release': return [
      { key: 'releaseA.title', label: 'Release A', sortable: false },
      { key: 'releaseA.trackCount', label: 'A Tracks', sortable: false, width: 'w-20' },
      { key: 'releaseB.title', label: 'Release B', sortable: false },
      { key: 'releaseB.trackCount', label: 'B Tracks', sortable: false, width: 'w-20' },
    ]
    case 'mismatched-release-id': return [
      { key: 'releaseA.title', label: 'Release A', sortable: false },
      { key: 'releaseB.title', label: 'Release B', sortable: false },
      { key: 'releaseA.release.title', label: 'Shared MB Title', sortable: false },
    ]
    default: return []
  }
}

export const resolvedIssueColumns = (type: IssueType): IssueColumn[] => {
  switch (type) {
    case 'corrupted': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'previousValue', label: 'Previous', sortable: false },
      { key: 'appliedValue', label: 'Applied', sortable: false },
      { key: 'folder', label: 'Folder', sortable: false },
      { key: 'fixedAt', label: 'Fixed At', sortable: false, width: 'w-28' },
    ]
    case 'missing': return [
      { key: 'track.title', label: 'Title', sortable: false },
      { key: 'previousValue', label: 'Previous', sortable: false },
      { key: 'appliedValue', label: 'Applied', sortable: false },
      { key: 'folder', label: 'Folder', sortable: false },
      { key: 'fixedAt', label: 'Fixed At', sortable: false, width: 'w-28' },
    ]
    default: return []
  }
}

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  corrupted: 'Corrupted TPE2',
  orphans: 'Orphan Artists',
  duplicates: 'Duplicate Artists',
  missing: 'Missing Metadata',
  enrichment: 'Enrichment Gaps',
  'duplicate-release': 'Duplicate Releases',
  'mismatched-release-id': 'Mismatched Release ID',
}

export const ISSUE_TYPE_DESCRIPTIONS: Record<IssueType, { detection: string; fix: string }> = {
  corrupted: {
    detection: 'Tracks where the album artist tag (TPE2) contains numeric garbage, bitrate markers, or file path fragments instead of an actual artist name.',
    fix: 'Rewrites the TPE2 tag in the original audio file with the proposed value, then requires a re-index to update the database.',
  },
  orphans: {
    detection: 'Artists with no linked releases or tracks - either phantom entries with corrupted names (numeric/bitrate garbage) or fully disconnected records.',
    fix: 'Deletes the orphan artist record directly from the database. No files are modified.',
  },
  duplicates: {
    detection: 'Artist pairs whose names match after normalizing case and stripping punctuation, suggesting they represent the same artist.',
    fix: 'Rewrites artist and album artist tags in audio files from B to A, then merges all releases, tracks, and links in the database. Requires a re-index afterward.',
  },
  missing: {
    detection: 'Tracks missing one or more required metadata fields: title, artist, album artist, album, or year.',
    fix: 'Writes the proposed values into the original audio file tags, then requires a re-index to update the database.',
  },
  enrichment: {
    detection: 'Releases missing enrichment data: MusicBrainz link, BPM, mood, AcousticID, Discogs, Bandcamp, or Wikipedia URLs.',
    fix: 'Enrichment gaps are resolved by re-syncing with MusicBrainz or running external analysis tools. No automatic fix available - use the re-sync button where applicable.',
  },
  'duplicate-release': {
    detection: 'Local release pairs pointing at the same MusicBrainz release with matching title, track count, and duration - likely the same edition ripped into two different folders.',
    fix: 'No automatic fix - review and manually delete the redundant folder copy.',
  },
  'mismatched-release-id': {
    detection: 'Local release pairs pointing at the same MusicBrainz release despite having different titles - a sync-matcher bug linking unrelated albums to the same release row.',
    fix: 'No automatic fix - requires re-running the sync matcher, not a mechanical database edit.',
  },
}

// The folder a row's file lives in: everything but the last path segment, or '-' when the row has no path.
export const folderPathOf = (item: { track?: { filePath?: string | null } | null, folderPath?: string | null }): string => {
  const fp = item.track?.filePath || item.folderPath || ''
  return fp ? fp.split('/').slice(0, -1).join('/') : '-'
}

interface HistoryItem {
  fixHistory?: { previousState: unknown, appliedState: unknown, appliedAt: string }[]
}

export interface HistoryEntry { key: string, value: string }

// What a fix replaced: the previous values of the fields it changed.
export const historyPreviousEntries = (item: HistoryItem): HistoryEntry[] => {
  const history = item.fixHistory?.[0]
  if (!history) {
    return []
  }
  const previous = (history.previousState ?? {}) as Record<string, unknown>
  const appliedKeys = Object.keys((history.appliedState as Record<string, unknown>) ?? {})
  return Object.entries(previous)
    .filter(([k, v]) => v != null && v !== '' && appliedKeys.includes(k))
    .map(([k, v]) => ({ key: k, value: String(v) }))
}

// What a fix wrote.
export const historyAppliedEntries = (item: HistoryItem): HistoryEntry[] => {
  const history = item.fixHistory?.[0]
  if (!history) {
    return []
  }
  return Object.entries((history.appliedState ?? {}) as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => ({ key: k, value: String(v) }))
}

export const historyDateOf = (item: HistoryItem): string => {
  const history = item.fixHistory?.[0]
  return history
    ? new Date(history.appliedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-'
}
