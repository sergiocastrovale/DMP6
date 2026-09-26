import { describe, expect, it } from 'vitest'
import { generateSlug, playlistSlug } from '../../../server/utils/slug'

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

  it('folds accents instead of dropping the letter', () => {
    expect(generateSlug('Café Tacvba')).toBe('cafe-tacvba')
    expect(generateSlug('Björk')).toBe('bjork')
    expect(generateSlug('ﬁne')).toBe('fine')
  })

  it('leaves a name with no Latin letters empty (callers that need a slug use playlistSlug)', () => {
    expect(generateSlug('日本語のプレイリスト')).toBe('')
    expect(generateSlug('🎵🎶')).toBe('')
  })
})

describe('playlistSlug', () => {
  it('is the plain slug when there is one', () => {
    expect(playlistSlug('Road Trip')).toBe('road-trip')
    expect(playlistSlug('Café')).toBe('cafe')
  })

  it('falls back to playlist-<6 hex> when nothing Latin survives, and differs between calls', () => {
    const a = playlistSlug('日本語')
    const b = playlistSlug('日本語')
    expect(a).toMatch(/^playlist-[0-9a-f]{6}$/)
    expect(playlistSlug('!!!')).toMatch(/^playlist-[0-9a-f]{6}$/)
    expect(a).not.toBe(b)
  })
})
