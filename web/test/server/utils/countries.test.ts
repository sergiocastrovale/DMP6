import { describe, expect, it } from 'vitest'
import { countryName } from '../../../server/utils/countries'

describe('countryName', () => {
  it('names real ISO 3166-1 alpha-2 codes in English', () => {
    expect(countryName('PT')).toBe('Portugal')
    expect(countryName('GB')).toBe('United Kingdom')
    expect(countryName('US')).toBe('United States')
    expect(countryName('XK')).toBe('Kosovo')
  })

  it('shows a code the runtime does not know as itself, and never throws on junk', () => {
    expect(countryName('ZZZ')).toBe('ZZZ')
    expect(countryName('')).toBe('')
    expect(countryName('not a code')).toBe('not a code')
  })
})
