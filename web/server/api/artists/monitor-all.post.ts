import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

// Bulk-toggle monitoring across the whole catalogue (the 19K "monitor everything" switch).
// One updateMany; the global trickle worker then picks releases up, throttled + concurrency-capped.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')

  const body = await readBody(event)
  if (typeof body?.monitored !== 'boolean') {
    throw createError({ statusCode: 400, message: 'monitored (boolean) required' })
  }

  // Only real artists: skip related-only and junk/compound (';'-named) artists, which would
  // otherwise dump thousands of bogus MISSING entries into the download queue.
  const { count } = await prisma.artist.updateMany({
    where: body.monitored
      ? { relatedOnly: false, name: { not: { contains: ';' } } }
      : {}, // un-monitor: clear everyone
    data: { monitored: body.monitored },
  })

  return { monitored: body.monitored, count }
})
