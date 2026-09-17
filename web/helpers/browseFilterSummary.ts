// Browse page subtext: a running one-line summary of the active query, folding in the result count
// that used to sit as its own badge top-right of the page (PageTitle) - e.g. "Showing 42/1,240
// artists matching 'Boards', sorted by Name (asc), only Ambient or Electronic, 20% – 40%
// completeness." Pure so it's testable without mounting the page - see docs/design_system.md
// "New pure logic -> importable helper".
import { browseSortOptions } from '~/helpers/constants'
import type { SortDirection } from '~/types/common'

export interface BrowseFilterSummaryInput {
  searchQuery: string
  sortBy: string
  sortDir: SortDirection
  genreFilters: string[]
  minCompleteness: number | null
  maxCompleteness: number | null
  // total: how many artists match the current filters. mainCount: the library's whole artist
  // count, unaffected by filters - shown as `total/mainCount` only once they diverge, otherwise
  // just `total` (which then also equals mainCount, so there's nothing to contrast).
  total: number
  mainCount: number
}

export const browseFilterSummary = (input: BrowseFilterSummaryInput): string => {
  const sortLabel = browseSortOptions.find(o => o.value === input.sortBy)?.label ?? input.sortBy
  const countPhrase = input.total === input.mainCount
    ? input.total.toLocaleString()
    : `${input.total.toLocaleString()}/${input.mainCount.toLocaleString()}`
  const matching = input.searchQuery ? ` matching '${input.searchQuery}'` : ''

  const parts = [`Showing ${countPhrase} artist${input.total === 1 ? '' : 's'}${matching}, sorted by ${sortLabel} (${input.sortDir})`]

  if (input.genreFilters.length) {
    parts.push(`only ${input.genreFilters.join(' or ')}`)
  }
  if (input.minCompleteness !== null || input.maxCompleteness !== null) {
    parts.push(`${input.minCompleteness ?? 0}% – ${input.maxCompleteness ?? 100}% completeness`)
  }

  return `${parts.join(', ')}.`
}
