import { describe, expect, it } from 'vitest'
import { normalizeTitle } from '../../../server/utils/releaseTitle'

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle("Who's Next!")).toBe('who s next')
  })

  it('strips diacritics', () => {
    expect(normalizeTitle('Café Del Mar')).toBe('cafe del mar')
  })

  it('strips bracketed qualifiers', () => {
    expect(normalizeTitle('Album Title [FLAC]')).toBe('album title')
    expect(normalizeTitle('Album Title (Deluxe Edition)')).toBe('album title')
    expect(normalizeTitle('Album Title {Remaster}')).toBe('album title')
  })

  it('collapses whitespace', () => {
    expect(normalizeTitle('  Too    Many   Spaces  ')).toBe('too many spaces')
  })
})
