import { prisma } from '~/server/utils/prisma'
import { invalidateShared } from '~/server/utils/cache'
import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { monitorArtistBodySchema } from '~/server/schemas/artists'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const slug = getRouterParam(event, 'slug')
  if (!slug) {throw createError({ statusCode: 400, statusMessage: 'Missing slug' })}

  const body = await readBodyOf(event, monitorArtistBodySchema)

  const artist = await prisma.artist.update({
    where: { slug },
    data: { monitored: body.monitored },
    select: { id: true, name: true, monitored: true },
  })

  await invalidateShared(`artist:${slug}`)

  // No per-artist kick: the global trickle worker (topUpDownloads) covers all monitored artists
  // uniformly, throttled + concurrency-capped, so toggling many can't flood Soulseek.
  return { monitored: artist.monitored }
})
