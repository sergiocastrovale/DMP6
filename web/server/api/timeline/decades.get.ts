import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  // Get all distinct decades from local releases that have years
  const releases = await prisma.localRelease.findMany({
    where: {
      year: { not: null },
    },
    select: {
      year: true,
    },
  })

  // Group by decade
  const decadeMap = new Map<number, number>()
  for (const r of releases) {
    if (r.year) {
      const decade = Math.floor(r.year / 10) * 10
      decadeMap.set(decade, (decadeMap.get(decade) || 0) + 1)
    }
  }

  // Sort decades descending
  const decades = Array.from(decadeMap.entries())
    .map(([decade, count]) => ({ decade, count }))
    .sort((a, b) => b.decade - a.decade)

  return decades
})
