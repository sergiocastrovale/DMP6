import { isAbortError } from '~/helpers/functions'

// The message worth showing for a failed $fetch: what the server said (createError's message or statusMessage travel in
// `data`), else the caller's own wording. Never ofetch's default "[POST] /api/x: 500 Internal Server Error", which
// names a route and helps nobody.
export const apiErrorMessage = (e: unknown, fallback: string): string => {
  const data = (e as { data?: { message?: unknown, statusMessage?: unknown } } | null)?.data
  for (const candidate of [data?.message, data?.statusMessage]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return fallback
}

// A request the client itself cancelled (a newer one superseded it) is not a failure to report.
export const shouldReportError = (e: unknown): boolean => !isAbortError(e)
