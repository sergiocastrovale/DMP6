import { describe, expect, it } from 'vitest'
import {
  AUDIT_ONLY_ISSUE_TYPES, ISSUE_TYPE_DESCRIPTIONS, ISSUE_TYPE_LABELS, REVERTABLE_ISSUE_TYPES,
  folderPathOf, historyAppliedEntries, historyDateOf, historyPreviousEntries, issueColumns, resolvedIssueColumns,
} from '../../helpers/issueColumns'
import type { IssueType } from '../../types/issues'

const TYPES: IssueType[] = ['corrupted', 'orphans', 'duplicates', 'missing', 'enrichment', 'duplicate-release', 'mismatched-release-id']

describe('per-type tables', () => {
  it('every type has columns, a label and a description', () => {
    for (const t of TYPES) {
      expect(issueColumns(t, true).length).toBeGreaterThan(0)
      expect(ISSUE_TYPE_LABELS[t]).toBeTruthy()
      expect(ISSUE_TYPE_DESCRIPTIONS[t].detection).toBeTruthy()
      expect(ISSUE_TYPE_DESCRIPTIONS[t].fix).toBeTruthy()
    }
  })

  it('the proposed-fix column is editable only for someone who can fix', () => {
    const proposed = (canFix: boolean) => issueColumns('corrupted', canFix).find(c => c.key === 'proposedValue')!
    expect(proposed(true).editable).toBe(true)
    expect(proposed(false).editable).toBe(false)
  })

  it('only the revertable types have a fixed-history table', () => {
    for (const t of TYPES) {
      expect(resolvedIssueColumns(t).length > 0).toBe(REVERTABLE_ISSUE_TYPES.includes(t))
    }
  })

  it('audit-only types are never revertable', () => {
    expect(AUDIT_ONLY_ISSUE_TYPES.some(t => REVERTABLE_ISSUE_TYPES.includes(t))).toBe(false)
  })
})

describe('folderPathOf', () => {
  it('drops the last path segment, preferring the track file over the folder path', () => {
    expect(folderPathOf({ track: { filePath: 'A/B/01.flac' } })).toBe('A/B')
    expect(folderPathOf({ folderPath: 'A/B/C' })).toBe('A/B')
    expect(folderPathOf({ track: { filePath: 'X/y.mp3' }, folderPath: 'other/z' })).toBe('X')
  })

  it('is a dash when there is no path', () => {
    expect(folderPathOf({})).toBe('-')
    expect(folderPathOf({ track: null, folderPath: '' })).toBe('-')
  })
})

describe('fix history entries', () => {
  const item = {
    fixHistory: [{
      previousState: { albumArtist: 'Old', title: 'Same', year: '' },
      appliedState: { albumArtist: 'New', year: 1999, note: null },
      appliedAt: '2026-03-04T10:15:00Z',
    }],
  }

  it('previous entries are the old values of the fields the fix changed, without blanks', () => {
    expect(historyPreviousEntries(item)).toEqual([{ key: 'albumArtist', value: 'Old' }])
  })

  it('applied entries are what was written, without nulls or blanks', () => {
    expect(historyAppliedEntries(item)).toEqual([{ key: 'albumArtist', value: 'New' }, { key: 'year', value: '1999' }])
  })

  it('a row with no history has no entries and a dash for its date', () => {
    expect(historyPreviousEntries({})).toEqual([])
    expect(historyAppliedEntries({ fixHistory: [] })).toEqual([])
    expect(historyDateOf({})).toBe('-')
  })

  it('the date reads the newest history row', () => {
    expect(historyDateOf(item)).not.toBe('-')
  })
})
