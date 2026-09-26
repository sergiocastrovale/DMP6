import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

// Release counts per decade. A plain GROUP BY over LocalRelease (150k rows, index on year) is milliseconds,
// and the result is cached; an earlier design read a `dmp_timeline` materialized view that no migration
// ever created, so every uncached call ran a failing query before falling back to this one.
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300, stale-while-revalidate=60')

  return cachedResponse('timeline:decades', 300, async () => {
    const rows = await prisma.$queryRaw<{ decade: number; count: bigint }[]>`
      SELECT (FLOOR(year / 10) * 10)::int AS decade, COUNT(*)::bigint AS count
      FROM "LocalRelease"
      WHERE year IS NOT NULL AND year > 0
      GROUP BY decade
      ORDER BY decade DESC
    `
    return rows.map(r => ({ decade: r.decade, count: Number(r.count) }))
  }, { shared: true })
})
