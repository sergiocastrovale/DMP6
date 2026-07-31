import { describe, expect, it } from 'vitest'
import { isForeignKeyError, isUniqueConstraintError } from '../../../server/utils/prismaErrors'

describe('isUniqueConstraintError', () => {
  it('matches a P2002 error', () => {
    expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true)
  })

  it('rejects other codes, non-objects and null', () => {
    expect(isUniqueConstraintError({ code: 'P2003' })).toBe(false)
    expect(isUniqueConstraintError(new Error('boom'))).toBe(false)
    expect(isUniqueConstraintError(null)).toBe(false)
    expect(isUniqueConstraintError('P2002')).toBe(false)
  })
})

describe('isForeignKeyError', () => {
  it('matches a P2003 error', () => {
    expect(isForeignKeyError({ code: 'P2003' })).toBe(true)
  })

  it('rejects other codes, non-objects and null', () => {
    expect(isForeignKeyError({ code: 'P2002' })).toBe(false)
    expect(isForeignKeyError(new Error('boom'))).toBe(false)
    expect(isForeignKeyError(null)).toBe(false)
  })
})
