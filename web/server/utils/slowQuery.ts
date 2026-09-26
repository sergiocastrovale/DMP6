// Slow-query logging for the Prisma `query` event. Only the statement's first 300 characters and its duration are
// logged - never the parameters, which carry search terms and user ids - and one distinct statement is reported at
// most once per THROTTLE_MS so a hot slow query cannot flood the log.

const MAX_SQL_CHARS = 300
const THROTTLE_MS = 10_000
const MAX_TRACKED = 200

export interface QueryEvent { query: string, duration: number }

export const formatSlowQuery = (event: QueryEvent): string => {
  const sql = event.query.replace(/\s+/g, ' ').trim()
  return `slow query ${event.duration}ms: ${sql.length > MAX_SQL_CHARS ? `${sql.slice(0, MAX_SQL_CHARS)}…` : sql}`
}

export const createSlowQueryLogger = (
  thresholdMs: number,
  sink: (line: string) => void,
  now: () => number = Date.now,
) => {
  const lastLogged = new Map<string, number>()
  return (event: QueryEvent): void => {
    if (event.duration < thresholdMs) {return}
    const signature = event.query.replace(/\s+/g, ' ').trim().slice(0, MAX_SQL_CHARS)
    const at = now()
    const previous = lastLogged.get(signature)
    if (previous !== undefined && at - previous < THROTTLE_MS) {return}
    lastLogged.delete(signature)
    lastLogged.set(signature, at)
    if (lastLogged.size > MAX_TRACKED) {
      const oldest = lastLogged.keys().next().value
      if (oldest !== undefined) {lastLogged.delete(oldest)}
    }
    sink(formatSlowQuery(event))
  }
}
