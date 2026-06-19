import { requirePermission } from '~/server/utils/permissions'
import { prisma } from '~/server/utils/prisma'
import { mergeManyDownloadedReleases } from '~/server/utils/promote'

// SSE variant of merge-all: streams merge step lines to the terminal store (used when showTerminal=true).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const body = await readBody(event).catch(() => ({})) as { ids?: string[] }
  const ids = Array.isArray(body.ids) && body.ids.length
    ? body.ids
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
