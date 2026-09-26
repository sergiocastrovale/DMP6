export function parsePagination(
  query: Record<string, unknown>,
  opts: { defaultSize?: number; maxSize?: number } = {},
) {
  const defaultSize = opts.defaultSize ?? 20
  const maxSize = opts.maxSize ?? 100
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(maxSize, Math.max(1, Number(query.pageSize) || defaultSize))
  return { page, pageSize, skip: (page - 1) * pageSize }
}

export interface PageInfo { page: number, pageSize: number, skip: number }

// The one shape every paged endpoint answers with. `extra` carries an endpoint's own fields (a total that
// ignores the filter, a year histogram) alongside the standard ones.
export const paged = <T, E extends object = Record<never, never>>(
  items: T[],
  total: number,
  { page, pageSize, skip }: PageInfo,
  extra?: E,
) => ({
  items,
  total,
  page,
  pageSize,
  hasMore: skip + items.length < total,
  ...(extra ?? ({} as E)),
})
