import { describe, expect, it } from 'vitest'
import { generateSlug } from '../../../server/utils/slug'

describe('generateSlug', () => {
  it('lowercases and hyphenates non-alphanumeric runs', () => {
    expect(generateSlug('Boards Of Canada')).toBe('boards-of-canada')
  })

  it('trims leading/trailing hyphens', () => {
    expect(generateSlug('  Boards!  ')).toBe('boards')
  })

  it('a name with no letters or digits produces an empty slug (audit #79 - caller must reject this)', () => {
    expect(generateSlug('!!!')).toBe('')
  })

  it('collapses consecutive separators into one hyphen', () => {
    expect(generateSlug('A -- B')).toBe('a-b')
  })
})
