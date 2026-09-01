// Browse's sort contract, shared by the store and /api/artists so the default direction is stated
// once. Deliberately dependency-free: it is the only module imported from both `helpers/` and
// `server/`, and it stays that way by having nothing to drag along.
import type { SortDirection } from '~/types/common'

export const BROWSE_SORT_FIELDS = ['name', 'releases', 'tracks', 'completeness', 'playCount', 'score', 'recent'] as const

// Picking a new column should show its most useful end first: names read A→Z, every other column is
// a quantity, where the interesting rows are the big ones.
export const defaultSortDirection = (field: string): SortDirection => (field === 'name' ? 'asc' : 'desc')

export const isSortDirection = (value: unknown): value is SortDirection =>
  value === 'asc' || value === 'desc'

// The direction to apply for a request: what the caller asked for, or the field's default when they
// asked for nothing (a direct API call, or a link with only `?sort=`).
export const resolveSortDirection = (field: string, requested: unknown): SortDirection =>
  isSortDirection(requested) ? requested : defaultSortDirection(field)
