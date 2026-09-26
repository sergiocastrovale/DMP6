import { requirePermission } from '~/server/utils/permissions'
import { openSse } from '~/server/utils/sse'
import { readBodyOf } from '~/server/utils/requestValidation'
import { optionalIdsBodySchema } from '~/server/schemas/common'
import { prisma } from '~/server/utils/prisma'
import { mergeManyDownloadedReleases } from '~/server/utils/promote'
import { assertCanMerge } from '~/server/utils/downloadEnvironment'

// SSE variant of merge-all: streams merge step lines to the terminal store (every merge routes here).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')
  await assertCanMerge()

  const { ids: bodyIds } = await readBodyOf(event, optionalIdsBodySchema)
  const ids = bodyIds?.length
    ? bodyIds
    : (await prisma.downloadedRelease.findMany({ where: { status: 'READY' }, select: { id: true } })).map(r => r.id)

  const sse = openSse(event)

  try {
    if (!ids.length) {
      sse.send('Nothing to merge.')
      sse.done(0)
      return
    }
    const { merged } = await mergeManyDownloadedReleases(ids, sse.send)
    if (!merged) {
      sse.send('No releases merged.')
    }
    // errors are already emitted line-by-line via send() during the run
    sse.done(0)
  }
  catch (e: any) {
    sse.send(`Error: ${e?.message || e}`)
    sse.done(1)
  }
})
