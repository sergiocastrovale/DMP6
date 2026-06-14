import { prisma } from '~/server/utils/prisma'
import { invalidateCache } from '~/server/utils/cache'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const body = await readBody(event)
  if (typeof body?.monitored !== 'boolean') {
    throw createError({ statusCode: 400, message: 'monitored (boolean) required' })
  }

  const artist = await prisma.artist.update({
    where: { slug },
    data: { monitored: body.monitored },
    select: { id: true, name: true, monitored: true },
  })

  await invalidateCache(`artist:${slug}`)

  // No per-artist kick: the global trickle worker (topUpDownloads) covers all monitored artists
  // uniformly, throttled + concurrency-capped, so toggling many can't flood Soulseek.
  return { monitored: artist.monitored }
})
