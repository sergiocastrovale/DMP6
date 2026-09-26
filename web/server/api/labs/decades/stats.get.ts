import type { DecadeStats } from '~/types/labs'
import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { decadeAggregates, decadePlayTotals, withPlayTotals } from '~/server/utils/decadeStats'

export default defineEventHandler(async (event): Promise<DecadeStats[]> => {
  const userId = currentUserId(event)

  // The library-wide part is cached for a day (and dropped the moment a scan changes the library); only this
  // user's play totals are computed per request.
  const [aggregates, plays] = await Promise.all([
    cachedResponse('labs:decades', 86400, () => decadeAggregates(prisma), { shared: true }),
    decadePlayTotals(prisma, userId),
  ])
  return withPlayTotals(aggregates, plays)
})
