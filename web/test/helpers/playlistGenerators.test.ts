import { describe, expect, it } from 'vitest'
import { parseTerms, termsToText, validateGenerator } from '~/helpers/playlistGenerators'

describe('helpers/playlistGenerators', () => {
  describe('parseTerms', () => {
    it('trims lines and drops blanks', () => {
      expect(parseTerms('rock\n  grunge \n\n\n-indie rock\n')).toEqual(['rock', 'grunge', '-indie rock'])
    })

    it('dedupes case-insensitively, keeping the first occurrence', () => {
      expect(parseTerms('Rock\nrock\nROCK\ngrunge')).toEqual(['Rock', 'grunge'])
    })

    it('round-trips through termsToText', () => {
      const terms = ['rock', 'grunge', '-indie rock']
      expect(parseTerms(termsToText(terms))).toEqual(terms)
    })
  })

  describe('validateGenerator', () => {
    it('rejects an empty name', () => {
      expect(validateGenerator({ type: 'GENRE', name: '', terms: ['rock'] })).toMatch(/name/i)
    })

    it('rejects a name with no letters or digits', () => {
      expect(validateGenerator({ type: 'GENRE', name: '!!!', terms: ['rock'] })).toMatch(/letter or number/i)
    })

    it('GENRE requires at least one non-exclude keyword line', () => {
      expect(validateGenerator({ type: 'GENRE', name: 'Rock', terms: [] })).toMatch(/keyword/i)
      expect(validateGenerator({ type: 'GENRE', name: 'Rock', terms: ['-indie rock'] })).toMatch(/keyword/i)
      expect(validateGenerator({ type: 'GENRE', name: 'Rock', terms: ['rock', '-indie rock'] })).toBeNull()
    })

    it('REGION requires at least one term', () => {
      expect(validateGenerator({ type: 'REGION', name: 'Japan', terms: [] })).toMatch(/country code/i)
    })

    it('REGION rejects a line that is not a 2-letter code', () => {
      expect(validateGenerator({ type: 'REGION', name: 'Japan', terms: ['JPN'] })).toMatch(/not a valid/i)
      expect(validateGenerator({ type: 'REGION', name: 'Japan', terms: ['JP'] })).toBeNull()
    })
  })
})
