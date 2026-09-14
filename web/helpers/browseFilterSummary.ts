// Browse page subtext: a running one-line summary of the active query, e.g. "'Boards' results
// sorted by Name (asc), only Ambient or Electronic, 20% – 40% completeness." Pure so it's testable
// without mounting the page - see docs/design_system.md "New pure logic -> importable helper".
import { browseSortOptions } from '~/helpers/constants'
import type { SortDirection } from '~/types/common'

export interface BrowseFilterSummaryInput {
  searchQuery: string
  sortBy: string
  sortDir: SortDirection
  genreFilters: string[]
  minCompleteness: number | null
  maxCompleteness: number | null
}

export const browseFilterSummary = (input: BrowseFilterSummaryInput): string => {
  const sortLabel = browseSortOptions.find(o => o.value === input.sortBy)?.label ?? input.sortBy
  const parts = [`${input.searchQuery ? `'${input.searchQuery}' results` : 'Results'} sorted by ${sortLabel} (${input.sortDir})`]

  if (input.genreFilters.length) {
    parts.push(`only ${input.genreFilters.join(' or ')}`)
  }
  if (input.minCompleteness !== null || input.maxCompleteness !== null) {
    parts.push(`${input.minCompleteness ?? 0}% – ${input.maxCompleteness ?? 100}% completeness`)
  }

  return `${parts.join(', ')}.`
}
