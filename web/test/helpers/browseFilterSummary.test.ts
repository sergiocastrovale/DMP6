import { describe, expect, it } from 'vitest'
import { browseFilterSummary } from '../../helpers/browseFilterSummary'

const base = {
  searchQuery: '',
  sortBy: 'name',
  sortDir: 'asc' as const,
  genreFilters: [] as string[],
  minCompleteness: null,
  maxCompleteness: null,
}

describe('browseFilterSummary', () => {
  it('always states the sort, even with nothing else active', () => {
    expect(browseFilterSummary(base)).toBe('Results sorted by Name (asc).')
  })

  it('quotes the search query and uses the sort option\'s label', () => {
    expect(browseFilterSummary({ ...base, searchQuery: 'Boards', sortBy: 'playCount', sortDir: 'desc' }))
      .toBe("'Boards' results sorted by Play count (desc).")
  })

  it('falls back to the raw field name for an unknown sort value', () => {
    expect(browseFilterSummary({ ...base, sortBy: 'whatever' })).toBe('Results sorted by whatever (asc).')
  })

  it('joins multiple checked genres with "or" (OR match)', () => {
    expect(browseFilterSummary({ ...base, genreFilters: ['Progressive Rock'] }))
      .toBe('Results sorted by Name (asc), only Progressive Rock.')
    expect(browseFilterSummary({ ...base, genreFilters: ['Progressive Rock', 'Ambient'] }))
      .toBe('Results sorted by Name (asc), only Progressive Rock or Ambient.')
  })

  it('shows the completeness band, defaulting an unset bound to 0/100', () => {
    expect(browseFilterSummary({ ...base, minCompleteness: 20, maxCompleteness: 40 }))
      .toBe('Results sorted by Name (asc), 20% – 40% completeness.')
    expect(browseFilterSummary({ ...base, minCompleteness: 80, maxCompleteness: null }))
      .toBe('Results sorted by Name (asc), 80% – 100% completeness.')
    expect(browseFilterSummary({ ...base, minCompleteness: null, maxCompleteness: 40 }))
      .toBe('Results sorted by Name (asc), 0% – 40% completeness.')
  })

  it('combines search, genre and completeness together, in order', () => {
    expect(browseFilterSummary({
      searchQuery: 'Test',
      sortBy: 'name',
      sortDir: 'asc',
      genreFilters: ['Progressive Rock'],
      minCompleteness: 20,
      maxCompleteness: 40,
    })).toBe("'Test' results sorted by Name (asc), only Progressive Rock, 20% – 40% completeness.")
  })
})
