import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { monitorSelectedBodySchema } from '~/server/schemas/artists'

// Bulk-toggle monitoring across a specific set of artists (the /downloads monitoring tab's
// "Monitor/Unmonitor selected"). One updateMany; the global trickle worker then picks releases up.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const body = await readBodyOf(event, monitorSelectedBodySchema)

  const { count } = await prisma.artist.updateMany({
    where: { id: { in: body.ids } },
    data: { monitored: body.monitored },
  })

  return { monitored: body.monitored, count }
})
