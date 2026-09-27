import { describe, expect, it } from 'vitest'
import { homonymNote, regionName } from '../../helpers/homonyms'

describe('homonymNote', () => {
  it('joins MusicBrainz\'s comment and the country', () => {
    expect(homonymNote({ disambiguation: 'Portuguese band', country: 'PT' })).toBe('Portuguese band · Portugal')
  })

  it('uses whichever of the two it has', () => {
    expect(homonymNote({ country: 'KR' })).toBe('South Korea')
    expect(homonymNote({ disambiguation: 'Korean illustrator', country: null })).toBe('Korean illustrator')
  })

  it('is null with nothing to tell them apart by', () => {
    expect(homonymNote({})).toBeNull()
    expect(homonymNote({ disambiguation: '  ', country: '' })).toBeNull()
  })

  it('never says the same thing twice', () => {
    expect(homonymNote({ disambiguation: 'Portugal', country: 'PT' })).toBe('Portugal')
  })
})

describe('regionName', () => {
  it('names a country code and passes an unknown one through', () => {
    expect(regionName('pt')).toBe('Portugal')
    expect(regionName(null)).toBeNull()
    // MusicBrainz's "worldwide" pseudo-country is not a region ICU knows.
    expect(regionName('XW')).toBe('XW')
  })
})
