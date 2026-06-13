import { prisma } from '~/server/utils/prisma'
import { invalidateCache } from '~/server/utils/cache'
import { requirePermission } from '~/server/utils/permissions'
import { scanMissingAndDownload } from '~/server/utils/autoDownload'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'

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

  // Turning monitoring ON kicks an immediate scan for this artist (fire-and-forget);
  // the periodic loop takes over from there.
  if (artist.monitored) {
    const mon = await resolveMonitorSettings()
    scanMissingAndDownload({ limit: mon.monitorCap, artistId: artist.id })
      .then(r => console.log(`[monitor] kick ${artist.name}: scanned ${r.scanned} | queued ${r.queued} | skipped ${r.skipped} | no result ${r.noResult}`))
      .catch(e => console.error(`[monitor] kick ${artist.name} failed: ${e?.message || e}`))
  }

  return { monitored: artist.monitored }
})
