import { requirePermission } from '~/server/utils/permissions'
import { prisma } from '~/server/utils/prisma'
import { mergeManyDownloadedReleases } from '~/server/utils/promote'

// Batched merge of all (or the given) READY downloads into the library.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const body = await readBody(event).catch(() => ({})) as { ids?: string[] }
  const ids = Array.isArray(body.ids) && body.ids.length
    ? body.ids
    : (await prisma.downloadedRelease.findMany({ where: { status: 'READY' }, select: { id: true } })).map(r => r.id)

  return mergeManyDownloadedReleases(ids)
})
