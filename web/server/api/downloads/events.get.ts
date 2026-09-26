import { requirePermission } from '~/server/utils/permissions'
import { openSse } from '~/server/utils/sse'
import { downloadChanges } from '~/server/utils/downloadEvents'

// Server-sent events for the Downloads pages: one `changed` event (the version as data) whenever the queue, the pause state
// or the merge batch changed, and the client re-reads /api/downloads/queue in response. This replaced every open tab
// polling that heavy endpoint every 2-15 s; the stream carries no data itself, so it needs nothing beyond the same
// permission the queue has. `hello` on connect tells the client the channel is live.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const sse = openSse(event)
  const unsubscribe = downloadChanges.subscribe(version => sse.sendEvent('changed', String(version)))
  sse.sendEvent('hello', String(downloadChanges.version))

  return new Promise<void>((resolve) => {
    sse.onClose(() => {
      unsubscribe()
      resolve()
    })
  })
})
