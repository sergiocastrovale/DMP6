import { describe, expect, it, vi } from 'vitest'

const model = () => ({ count: vi.fn(async () => 2), update: vi.fn(), updateMany: vi.fn() })
const models = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof model>>)

vi.mock('~/server/utils/prisma', () => {
  const names = ['issueCorruptedTpe2', 'issueOrphanArtist', 'issueDuplicateArtist', 'issueMissingMetadata', 'issueEnrichmentGap', 'issueDuplicateRelease', 'issueMismatchedReleaseId']
  const prisma: Record<string, unknown> = {}
  for (const n of names) {
    const m = { count: vi.fn(async () => 2), update: vi.fn(), updateMany: vi.fn() }
    models[n] = m as never
    prisma[n] = m
  }
  return { prisma }
})

const { ISSUE_TYPES, countByStatus, findIssueType, isIssueType, requireIssueType } = await import('../../../server/utils/issueTypes')

describe('issue type registry', () => {
  it('lists the seven types once, in UI order', () => {
    expect(ISSUE_TYPES.map(t => t.id)).toEqual(['corrupted', 'orphans', 'duplicates', 'missing', 'enrichment', 'duplicate-release', 'mismatched-release-id'])
    expect(new Set(ISSUE_TYPES.map(t => t.id)).size).toBe(7)
  })

  it('marks exactly the four fixable and two revertable types', () => {
    expect(ISSUE_TYPES.filter(t => t.fixable).map(t => t.id)).toEqual(['corrupted', 'orphans', 'duplicates', 'missing'])
    expect(ISSUE_TYPES.filter(t => t.revertable).map(t => t.id)).toEqual(['corrupted', 'missing'])
  })

  it('only the two editable types accept a patch, and only their own field', () => {
    expect(findIssueType('corrupted')?.patchableFields).toEqual(['proposedValue'])
    expect(findIssueType('missing')?.patchableFields).toEqual(['proposedValues'])
    expect(ISSUE_TYPES.filter(t => t.patchableFields.length).map(t => t.id)).toEqual(['corrupted', 'missing'])
  })

  it('isIssueType / findIssueType reject unknown ids', () => {
    expect(isIssueType('orphans')).toBe(true)
    expect(isIssueType('nope')).toBe(false)
    expect(isIssueType(undefined)).toBe(false)
    expect(findIssueType('constructor')).toBeUndefined()
  })

  it('requireIssueType 404s an unknown or non-fixable type, and 400s a non-revertable revert', () => {
    expect(requireIssueType('corrupted', { fixable: true }).id).toBe('corrupted')
    expect(() => requireIssueType('nope')).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => requireIssueType('enrichment', { fixable: true })).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(() => requireIssueType('orphans', { revertable: true })).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('countByStatus asks every table for the status and keys the result by type id', async () => {
    const counts = await countByStatus('PENDING')
    expect(Object.keys(counts)).toEqual(ISSUE_TYPES.map(t => t.id))
    expect(Object.values(counts)).toEqual(Array(7).fill(2))
    for (const m of Object.values(models)) {
      expect(m.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } })
    }
  })
})
