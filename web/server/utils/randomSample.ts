// Uniform-ish random rows from a big table without sorting it.
//
// `TABLESAMPLE BERNOULLI(p) ... LIMIT n` (what this replaces) looked random but wasn't: the scan stops at the
// first n rows it keeps, so every result came from the first heap pages - the oldest-indexed tracks - and it
// still read the table sequentially. `TABLESAMPLE SYSTEM(p)` instead picks pages at random *before* reading
// them (I/O proportional to the sample, not the table), and the final `ORDER BY random() LIMIT n` shuffles
// only that sample. SYSTEM samples whole pages, so rows sharing a page (same album) travel together; the
// sample is oversampled 40x so n distinct-ish rows survive the shuffle.
//
// If a selective `where` leaves the sample short, the percentage is escalated twice and finally the query
// falls back to a plain `ORDER BY random()` over the filtered table, so callers always get min(n, matches).
import { Prisma, type PrismaClient } from '@prisma/client'

// Interpolated with Prisma.raw, so this whitelist is the injection boundary: never widen it to a
// caller-supplied string.
const SAMPLE_TABLES = {
  LocalReleaseTrack: Prisma.raw('"LocalReleaseTrack"'),
  LocalRelease: Prisma.raw('"LocalRelease"'),
  Artist: Prisma.raw('"Artist"'),
} as const

export type SampleTable = keyof typeof SAMPLE_TABLES

export const SAMPLE_OVERSAMPLE = 40
export const SAMPLE_ESCALATION = 8
export const SAMPLE_MAX_ESCALATIONS = 2
const MIN_PERCENT = 0.0001
const ROWS_CACHE_TTL_MS = 10 * 60_000

// Percentage of pages to sample so about n * OVERSAMPLE * multiplier rows come back. An unknown row count
// (never analyzed: reltuples <= 0) samples everything - only ever true of a tiny or brand-new table.
export const samplePercent = (n: number, estimatedRows: number, multiplier = 1): number =>
  estimatedRows > 0
    ? Math.min(100, Math.max(MIN_PERCENT, (n * SAMPLE_OVERSAMPLE * multiplier / estimatedRows) * 100))
    : 100

const rowsCache = new Map<SampleTable, { rows: number, at: number }>()

// pg_class.reltuples is the planner's own estimate: free to read and accurate to a few percent, which is all
// the sample size needs. Cached because it changes only when autovacuum re-analyzes.
const estimatedRows = async (prisma: PrismaClient, table: SampleTable, now: number): Promise<number> => {
  const hit = rowsCache.get(table)
  if (hit && now - hit.at < ROWS_CACHE_TTL_MS) {
    return hit.rows
  }
  const [row] = await prisma.$queryRaw<{ rows: number }[]>`
    SELECT reltuples::float8 AS rows FROM pg_class WHERE oid = ${`"${table}"`}::regclass`
  const rows = Number(row?.rows ?? 0)
  rowsCache.set(table, { rows, at: now })
  return rows
}

export const _resetSampleCacheForTest = (): void => {
  rowsCache.clear()
}

export const sampleIds = async (
  prisma: PrismaClient,
  table: SampleTable,
  n: number,
  where: Prisma.Sql = Prisma.sql`TRUE`,
  now: number = Date.now(),
): Promise<string[]> => {
  if (n <= 0) {
    return []
  }
  const tableSql = SAMPLE_TABLES[table]
  const rows = await estimatedRows(prisma, table, now)

  for (let attempt = 0; attempt <= SAMPLE_MAX_ESCALATIONS; attempt++) {
    const pct = samplePercent(n, rows, SAMPLE_ESCALATION ** attempt)
    const found = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM ${tableSql} TABLESAMPLE SYSTEM (${pct}::float4) WHERE ${where} ORDER BY random() LIMIT ${n}`
    if (found.length >= n || pct >= 100) {
      return found.map(r => r.id)
    }
  }

  const fallback = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ${tableSql} WHERE ${where} ORDER BY random() LIMIT ${n}`
  return fallback.map(r => r.id)
}
