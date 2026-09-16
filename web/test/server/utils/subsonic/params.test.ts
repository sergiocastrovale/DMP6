import { describe, expect, it } from 'vitest'
import { makeParams } from '../../../../server/utils/subsonic/params'
import { SubsonicApiError, SubsonicErrorCode } from '../../../../server/utils/subsonic/errors'

describe('makeParams', () => {
  it('reads a single string param', () => {
    const p = makeParams({ query: 'abba' })
    expect(p.str('query')).toBe('abba')
    expect(p.str('missing')).toBeUndefined()
  })

  it('strRequired throws a SubsonicApiError with code 10 when missing', () => {
    const p = makeParams({})
    expect(() => p.strRequired('id')).toThrow(SubsonicApiError)
    try {
      p.strRequired('id')
      expect.unreachable()
    }
    catch (e) {
      expect((e as SubsonicApiError).code).toBe(SubsonicErrorCode.MISSING_PARAM)
    }
  })

  it('treats an empty string as missing for strRequired', () => {
    const p = makeParams({ id: '' })
    expect(() => p.strRequired('id')).toThrow(SubsonicApiError)
  })

  it('parses int params, ignoring non-numeric input', () => {
    const p = makeParams({ size: '25', bad: 'nope' })
    expect(p.int('size')).toBe(25)
    expect(p.int('bad')).toBeUndefined()
    expect(p.int('missing')).toBeUndefined()
  })

  it('parses bool params from "true"/"1", defaulting when absent', () => {
    const p = makeParams({ a: 'true', b: '1', c: 'false' })
    expect(p.bool('a')).toBe(true)
    expect(p.bool('b')).toBe(true)
    expect(p.bool('c')).toBe(false)
    expect(p.bool('missing')).toBe(false)
    expect(p.bool('missing', true)).toBe(true)
  })

  it('normalizes both a repeated param and a single one into a list', () => {
    const p = makeParams({ id: ['a', 'b'], other: 'x' })
    expect(p.list('id')).toEqual(['a', 'b'])
    expect(p.list('other')).toEqual(['x'])
    expect(p.list('missing')).toEqual([])
  })
})
