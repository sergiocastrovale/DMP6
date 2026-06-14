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

  // Only real (non related-only) artists are monitorable.
  const { count } = await prisma.artist.updateMany({
    where: { relatedOnly: false },
    data: { monitored: body.monitored },
  })

  return { monitored: body.monitored, count }
})
