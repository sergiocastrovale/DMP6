import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=60')

  try {
    // Query materialized view — pre-aggregated, sub-millisecond
    const rows = await prisma.$queryRaw<{ decade: number; count: bigint }[]>`
      SELECT decade, SUM(release_count)::bigint AS count
      FROM dmp_timeline
      GROUP BY decade
      ORDER BY decade DESC
    `
    return rows.map(r => ({ decade: r.decade, count: Number(r.count) }))
  }
  catch {
    // Fallback if materialized view doesn't exist yet
    const rows = await prisma.$queryRaw<{ decade: number; count: bigint }[]>`
      SELECT (FLOOR(year / 10) * 10)::int AS decade, COUNT(*)::bigint AS count
      FROM "LocalRelease"
      WHERE year IS NOT NULL AND year > 0
      GROUP BY decade
      ORDER BY decade DESC
    `
    return rows.map(r => ({ decade: r.decade, count: Number(r.count) }))
  }
})
