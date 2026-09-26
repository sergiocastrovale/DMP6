import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { optionalIdsBodySchema } from '~/server/schemas/common'
import { prisma } from '~/server/utils/prisma'
import { mergeManyDownloadedReleases } from '~/server/utils/promote'
import { assertCanMerge } from '~/server/utils/downloadEnvironment'

// Batched merge of all (or the given) READY downloads into the library.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')
  await assertCanMerge()

  const { ids: bodyIds } = await readBodyOf(event, optionalIdsBodySchema)
  const ids = bodyIds?.length
    ? bodyIds
    : (await prisma.downloadedRelease.findMany({ where: { status: 'READY' }, select: { id: true } })).map(r => r.id)

  return mergeManyDownloadedReleases(ids)
})
