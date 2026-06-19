import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

// Bulk-toggle monitoring across a specific set of artists (the /downloads monitoring tab's
// "Monitor/Unmonitor selected"). One updateMany; the global trickle worker then picks releases up.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')

  const body = await readBody(event)
  if (typeof body?.monitored !== 'boolean') {
    throw createError({ statusCode: 400, message: 'monitored (boolean) required' })
  }
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string') : []
  if (!ids.length) {
    throw createError({ statusCode: 400, message: 'ids (string[]) required' })
  }

  const { count } = await prisma.artist.updateMany({
    where: { id: { in: ids } },
    data: { monitored: body.monitored },
  })

  return { monitored: body.monitored, count }
})
