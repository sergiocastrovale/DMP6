import { requirePermission } from '~/server/utils/permissions'
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

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const res = event.node.res
  const send = (line: string) => res.write(`data: ${JSON.stringify(line)}\n\n`)

  try {
    if (!ids.length) {
      send('Nothing to merge.')
      res.write(`event: done\ndata: 0\n\n`)
      res.end()
      return
    }
    const { merged } = await mergeManyDownloadedReleases(ids, send)
    if (!merged) {
      send('No releases merged.')
    }
    // errors are already emitted line-by-line via send() during the run
    res.write(`event: done\ndata: 0\n\n`)
  }
  catch (e: any) {
    send(`Error: ${e?.message || e}`)
    res.write(`event: done\ndata: 1\n\n`)
  }
  finally {
    res.end()
  }
})
