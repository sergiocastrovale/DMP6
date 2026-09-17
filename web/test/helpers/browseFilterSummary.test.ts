import { describe, expect, it } from 'vitest'
import { browseFilterSummary } from '../../helpers/browseFilterSummary'

const base = {
  searchQuery: '',
  sortBy: 'name',
  sortDir: 'asc' as const,
  genreFilters: [] as string[],
  minCompleteness: null,
  maxCompleteness: null,
  total: 1240,
  mainCount: 1240,
}

describe('browseFilterSummary', () => {
  it('always states the count and sort, even with nothing else active', () => {
    expect(browseFilterSummary(base)).toBe('Showing 1,240 artists, sorted by Name (asc).')
  })

  it('shows total/mainCount once a filter narrows the result set below the library size', () => {
    expect(browseFilterSummary({ ...base, total: 42 }))
      .toBe('Showing 42/1,240 artists, sorted by Name (asc).')
  })

  it('uses the singular when exactly one artist matches', () => {
    expect(browseFilterSummary({ ...base, total: 1 }))
      .toBe('Showing 1/1,240 artist, sorted by Name (asc).')
  })

  it('quotes the search query and uses the sort option\'s label', () => {
    expect(browseFilterSummary({ ...base, total: 5, searchQuery: 'Boards', sortBy: 'playCount', sortDir: 'desc' }))
      .toBe("Showing 5/1,240 artists matching 'Boards', sorted by Play count (desc).")
  })

  it('falls back to the raw field name for an unknown sort value', () => {
    expect(browseFilterSummary({ ...base, sortBy: 'whatever' })).toBe('Showing 1,240 artists, sorted by whatever (asc).')
  })

  it('joins multiple checked genres with "or" (OR match)', () => {
    expect(browseFilterSummary({ ...base, total: 30, genreFilters: ['Progressive Rock'] }))
      .toBe('Showing 30/1,240 artists, sorted by Name (asc), only Progressive Rock.')
    expect(browseFilterSummary({ ...base, total: 30, genreFilters: ['Progressive Rock', 'Ambient'] }))
      .toBe('Showing 30/1,240 artists, sorted by Name (asc), only Progressive Rock or Ambient.')
  })

  it('shows the completeness band, defaulting an unset bound to 0/100', () => {
    expect(browseFilterSummary({ ...base, total: 30, minCompleteness: 20, maxCompleteness: 40 }))
      .toBe('Showing 30/1,240 artists, sorted by Name (asc), 20% – 40% completeness.')
    expect(browseFilterSummary({ ...base, total: 30, minCompleteness: 80, maxCompleteness: null }))
      .toBe('Showing 30/1,240 artists, sorted by Name (asc), 80% – 100% completeness.')
    expect(browseFilterSummary({ ...base, total: 30, minCompleteness: null, maxCompleteness: 40 }))
      .toBe('Showing 30/1,240 artists, sorted by Name (asc), 0% – 40% completeness.')
  })

  it('combines search, genre and completeness together, in order', () => {
    expect(browseFilterSummary({
      searchQuery: 'Test',
      sortBy: 'name',
      sortDir: 'asc',
      genreFilters: ['Progressive Rock'],
      minCompleteness: 20,
      maxCompleteness: 40,
      total: 3,
      mainCount: 1240,
    })).toBe("Showing 3/1,240 artists matching 'Test', sorted by Name (asc), only Progressive Rock, 20% – 40% completeness.")
  })
})
