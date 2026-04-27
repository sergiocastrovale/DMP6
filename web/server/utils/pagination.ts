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
