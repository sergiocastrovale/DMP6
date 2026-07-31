export type ParsedIntField =
  | { ok: true, value: number | null | undefined }
  | { ok: false }

/**
 * Parses a nullable/optional integer settings field from a PUT body.
 * - undefined (key absent from the request) -> not provided, leaves the stored value untouched
 * - null or '' -> clears the override (stored as null, falls back to env/default)
 * - anything that Number()s to a finite number -> that number, INCLUDING 0 (previously `|| null`
 *   silently turned a real 0 into "clear the override" - audit #85)
 * - anything else (e.g. "abc" -> NaN) -> invalid; the caller must reject the request rather than
 *   passing NaN through to Prisma, which throws an unhandled 500 for a non-numeric Int column
 */
export const parseNullableInt = (value: unknown): ParsedIntField => {
  if (value === undefined) {return { ok: true, value: undefined }}
  if (value === null || value === '') {return { ok: true, value: null }}
  const n = Number(value)
  if (!Number.isFinite(n)) {return { ok: false }}
  return { ok: true, value: n }
}
