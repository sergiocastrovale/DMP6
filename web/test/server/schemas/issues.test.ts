import { describe, it, expect } from 'vitest'
import { revertBodySchema, issuePatchBodySchema } from '../../../server/schemas/issues'
import { idsBodySchema, optionalIdsBodySchema } from '../../../server/schemas/common'

describe('idsBodySchema', () => {
  it('needs a non-empty array of strings', () => {
    expect(idsBodySchema.parse({ ids: ['a'] })).toEqual({ ids: ['a'] })
    expect(idsBodySchema.safeParse({}).success).toBe(false)
    expect(idsBodySchema.safeParse({ ids: [] }).success).toBe(false)
    expect(idsBodySchema.safeParse({ ids: 'a' }).success).toBe(false)
  })
})

describe('revertBodySchema', () => {
  it('needs a known mode', () => {
    expect(revertBodySchema.parse({ ids: ['a'], mode: 'undo' }).mode).toBe('undo')
    expect(revertBodySchema.safeParse({ ids: ['a'], mode: 'nuke' }).success).toBe(false)
    expect(revertBodySchema.safeParse({ ids: ['a'] }).success).toBe(false)
  })
})

describe('optionalIdsBodySchema', () => {
  it('accepts no ids (delete all) but never a malformed one', () => {
    expect(optionalIdsBodySchema.parse({}).ids).toBeUndefined()
    expect(optionalIdsBodySchema.parse({ ids: ['a'] }).ids).toEqual(['a'])
    expect(optionalIdsBodySchema.safeParse({ ids: 'a' }).success).toBe(false)
  })
})

describe('issuePatchBodySchema', () => {
  it('only requires an object', () => {
    expect(issuePatchBodySchema.parse({ proposedValue: 'x' })).toEqual({ proposedValue: 'x' })
    expect(issuePatchBodySchema.safeParse([]).success).toBe(false)
    expect(issuePatchBodySchema.safeParse('x').success).toBe(false)
  })
})
