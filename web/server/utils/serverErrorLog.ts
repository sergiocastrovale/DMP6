// One line per server-side failure (5xx), with enough request context to find it in `docker logs`: method, path (never the
// query string - it carries search terms and OAuth tokens), status, user, how long the request had run, and the stack.
// 4xx are the caller's mistake and stay out of the log.

export interface ServerErrorContext {
  method: string
  path: string
  status: number
  userId?: number | null
  durationMs?: number | null
  error: unknown
}

export const isServerError = (status: number): boolean => status >= 500

export const statusOf = (error: unknown): number => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' && status >= 100 && status < 600 ? status : 500
}

export const formatServerError = ({ method, path, status, userId, durationMs, error }: ServerErrorContext, now: Date = new Date()): string => {
  const err = error as { message?: string, stack?: string } | null
  const head = `[${now.toISOString()}][error] ${method} ${path} -> ${status}`
    + ` user=${userId ?? '-'}`
    + (durationMs != null ? ` ${durationMs}ms` : '')
    + `: ${err?.message ?? String(error)}`
  return err?.stack ? `${head}\n${err.stack}` : head
}
