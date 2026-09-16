import { describe, expect, it } from 'vitest'
import { indexLetterFor, groupByIndexLetter } from '../../../../server/utils/subsonic/indexing'

describe('indexLetterFor', () => {
  it('uses the first letter, uppercased', () => {
    expect(indexLetterFor('abba')).toBe('A')
    expect(indexLetterFor('Air')).toBe('A')
  })

  it('strips a leading ignored article', () => {
    expect(indexLetterFor('The Beatles')).toBe('B')
    expect(indexLetterFor('Los Lobos')).toBe('L')
  })

  it('does not strip an article that is not followed by a space (not really an article)', () => {
    expect(indexLetterFor('Thelonious Monk')).toBe('T')
  })

  it('falls back to # for a name not starting with a letter', () => {
    expect(indexLetterFor('65daysofstatic')).toBe('#')
    expect(indexLetterFor('!!!')).toBe('#')
  })
})

describe('groupByIndexLetter', () => {
  it('groups items by letter and sorts groups alphabetically', () => {
    const items = [{ name: 'Zappa' }, { name: 'The Beatles' }, { name: 'Air' }, { name: 'Aphex Twin' }]
    const grouped = groupByIndexLetter(items)
    expect(grouped.map(([letter]) => letter)).toEqual(['A', 'B', 'Z'])
    expect(grouped[0]![1].map(i => i.name)).toEqual(['Air', 'Aphex Twin'])
  })
})
