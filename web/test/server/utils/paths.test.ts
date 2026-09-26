import { describe, expect, it } from 'vitest'
import { sanitizePathSegment } from '../../../server/utils/paths'

describe('sanitizePathSegment', () => {
  it('replaces characters illegal in filenames and collapses whitespace', () => {
    expect(sanitizePathSegment('AC/DC: Back   in Black?')).toBe('AC_DC_ Back in Black_')
    expect(sanitizePathSegment('a\tb')).toBe('a_b')
    expect(sanitizePathSegment('a\x00b')).toBe('a_b')
  })

  it('trims and caps the length at 200', () => {
    expect(sanitizePathSegment('  x  ')).toBe('x')
    expect(sanitizePathSegment('y'.repeat(300))).toHaveLength(200)
  })
})
