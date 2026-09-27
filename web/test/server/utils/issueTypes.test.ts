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

const unidentified = vi.hoisted(() => ({ count: vi.fn(async () => 3) }))
vi.mock('~/server/utils/homonyms', () => ({ countUnidentifiedMembers: unidentified.count }))

const { ISSUE_TYPES, countByStatus, findIssueType, isIssueType, requireIssueType } = await import('../../../server/utils/issueTypes')

describe('issue type registry', () => {
  it('lists the eight types once, in UI order', () => {
    expect(ISSUE_TYPES.map(t => t.id)).toEqual(['corrupted', 'orphans', 'duplicates', 'missing', 'enrichment', 'duplicate-release', 'mismatched-release-id', 'ambiguous-artists'])
    expect(new Set(ISSUE_TYPES.map(t => t.id)).size).toBe(8)
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
    expect(Object.values(counts)).toEqual([...Array(7).fill(2), 0])
    for (const m of Object.values(models)) {
      expect(m.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } })
    }
  })

  it('counts the live ambiguous-artists list only as detected, and refuses a status change', async () => {
    const counts = await countByStatus('DETECTED')
    expect(counts['ambiguous-artists']).toBe(3)
    const def = findIssueType('ambiguous-artists')!
    expect(def.fixable).toBe(false)
    await expect(def.delegate.update({ where: { id: 'x' }, data: {} })).rejects.toMatchObject({ statusCode: 400 })
  })
})
