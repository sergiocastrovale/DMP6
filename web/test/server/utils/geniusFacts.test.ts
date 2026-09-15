import { describe, expect, it } from 'vitest'
import {
  extractFacts,
  factHash,
  pickSongHit,
  pickSubject,
  sameName,
  type GeniusSearchHit,
} from '../../../server/utils/geniusFacts'
import { normalizeTitle } from '../../../server/utils/releaseTitle'

describe('geniusFacts', () => {
  describe('extractFacts', () => {
    it('returns nothing for an empty/placeholder description', () => {
      expect(extractFacts(null)).toEqual([])
      expect(extractFacts(undefined)).toEqual([])
      expect(extractFacts('')).toEqual([])
      expect(extractFacts('?')).toEqual([])
      expect(extractFacts('  ?  ')).toEqual([])
    })

    it('splits on paragraph boundaries when each is short enough', () => {
      const text = 'Paragraph one is a normal length fact about the band history and formation.\n\n'
        + 'Paragraph two describes a different album and its critical reception at release.'
      expect(extractFacts(text)).toEqual([
        'Paragraph one is a normal length fact about the band history and formation.',
        'Paragraph two describes a different album and its critical reception at release.',
      ])
    })

    it('regroups an over-long paragraph into sentence-boundary chunks under the max length', () => {
      const sentence = 'This is one full sentence about the artist that repeats several words. '
      const longParagraph = sentence.repeat(10)
      const facts = extractFacts(longParagraph)

      expect(facts.length).toBeGreaterThan(1)
      for (const fact of facts) {
        expect(fact.length).toBeLessThanOrEqual(320)
        // never cut mid-sentence
        expect(fact.trim().endsWith('.')).toBe(true)
      }
    })

    it('drops fragments shorter than the minimum readable length', () => {
      const text = 'Too short.\n\nThis paragraph however is long enough to read as a standalone fact on its own.'
      expect(extractFacts(text)).toEqual([
        'This paragraph however is long enough to read as a standalone fact on its own.',
      ])
    })
  })

  describe('normalizeTitle / sameName', () => {
    it('strips parenthetical suffixes, punctuation and case', () => {
      expect(normalizeTitle('Paranoid Android (Remastered)')).toBe('paranoid android')
      expect(normalizeTitle('Paranoid Android')).toBe('paranoid android')
    })

    it('strips diacritics', () => {
      expect(normalizeTitle('Café Tacvba')).toBe('cafe tacvba')
    })

    it('matches names that differ only by a remaster/live suffix', () => {
      expect(sameName('Karma Police (Live)', 'Karma Police')).toBe(true)
      expect(sameName('Karma Police', 'Paranoid Android')).toBe(false)
    })
  })

  describe('pickSongHit', () => {
    const hits: GeniusSearchHit[] = [
      { type: 'song', result: { id: 1, title: 'Paranoid Android (Türkçe Çeviri)', primary_artist: { id: 999, name: 'Genius Türkçe Çeviriler' } } },
      { type: 'song', result: { id: 2, title: 'Paranoid Android', primary_artist: { id: 604, name: 'Radiohead' } } },
      { type: 'song', result: { id: 3, title: 'Paranoid Android (Cover)', primary_artist: { id: 604, name: 'Radiohead' } } },
    ]

    it('rejects hits by a different (translation/cover-crediting) artist', () => {
      const picked = pickSongHit(hits, 'Paranoid Android', 'Radiohead')
      expect(picked?.id).toBe(2)
    })

    it('returns null when no hit matches both title and artist', () => {
      expect(pickSongHit(hits, 'Karma Police', 'Radiohead')).toBeNull()
    })
  })

  describe('factHash', () => {
    it('is stable for the same normalized text', () => {
      expect(factHash('Some fact.')).toBe(factHash('Some fact.'))
    })

    it('is case/whitespace-insensitive (normalizes before hashing)', () => {
      expect(factHash('Some Fact')).toBe(factHash('some   fact'))
    })

    it('differs for different text', () => {
      expect(factHash('Fact one')).not.toBe(factHash('Fact two'))
    })
  })

  describe('pickSubject', () => {
    it('always returns one of the three known subjects', () => {
      for (let i = 0; i < 20; i++) {
        expect(['artist', 'release', 'track']).toContain(pickSubject())
      }
    })
  })
})
