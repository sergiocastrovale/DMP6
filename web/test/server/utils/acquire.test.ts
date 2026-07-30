import { describe, expect, it } from 'vitest'
import { albumFolderMatches } from '../../../server/utils/acquire'

describe('albumFolderMatches', () => {
  it('matches an exact (normalized) folder name', () => {
    expect(albumFolderMatches('/music/Some Artist/Diamonds Furcoat Champagne', 'Diamonds, Furcoat, Champagne')).toBe(true)
  })

  it('matches when the folder carries extra edition/format qualifiers', () => {
    expect(albumFolderMatches('Diamonds Furcoat Champagne (2008) [FLAC]', 'Diamonds, Furcoat, Champagne')).toBe(true)
  })

  it('matches on majority word overlap for near-matches', () => {
    expect(albumFolderMatches('Diamonds Furcoat and Champagne Remastered', 'Diamonds, Furcoat, Champagne')).toBe(true)
  })

  it('rejects a folder with no meaningful relation to the requested album', () => {
    expect(albumFolderMatches('Some Completely Unrelated Mixtape Vol 3', 'Diamonds, Furcoat, Champagne')).toBe(false)
  })

  it('rejects a different album by the same artist (short titles, no overlap)', () => {
    expect(albumFolderMatches('Wicked', 'Souls')).toBe(false)
  })

  it('never blocks on an empty/unknown album title', () => {
    expect(albumFolderMatches('anything at all', '')).toBe(true)
  })
})
