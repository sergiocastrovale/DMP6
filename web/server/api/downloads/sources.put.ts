import { requirePermission } from '~/server/utils/permissions'
import { prisma } from '~/server/utils/prisma'
import { getDownloadSources, invalidateDownloadSourcesCache } from '~/server/utils/downloadSources'
import type { DownloadSourceConfigItem } from '~/types/download'

// Update a download source's on/off switch (and optionally its retry policy / url). Body:
//   { name: 'RUTRACKER' | 'SLSKD', enabled?: boolean, retry?: boolean, url?: string | null }
export default defineEventHandler(async (event): Promise<{ sources: DownloadSourceConfigItem[] }> => {
  await requirePermission(event, 'variables.edit')

  const body = await readBody(event)
  if (body?.name !== 'RUTRACKER' && body?.name !== 'SLSKD') {
    throw createError({ statusCode: 400, message: 'name must be RUTRACKER or SLSKD' })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') {data.enabled = body.enabled}
  if (typeof body.retry === 'boolean') {data.retry = body.retry}
  if (typeof body.url === 'string' || body.url === null) {data.url = body.url}
  if (Object.keys(data).length === 0) {
    throw createError({ statusCode: 400, message: 'nothing to update' })
  }

  await prisma.downloadSourceConfig.update({ where: { name: body.name }, data })
  invalidateDownloadSourcesCache()
  const sources = await getDownloadSources()
  return { sources }
})
