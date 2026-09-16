import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { applyPlayEventPatch } from '~/server/utils/playEvents'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const userId = currentUserId(event)

  const id = getRouterParam(event, 'id')
  if (!id) {throw createError({ statusCode: 400, statusMessage: 'Missing id' })}

  // Sent as text/plain (not application/json) so the same payload shape works from sendBeacon
  // (server/api/play-events/[id]/finish.post.ts, page-hide only supports POST) as from a normal PATCH.
  const raw = await readRawBody(event, 'utf8')
  const body = raw ? JSON.parse(raw) : {}

  return applyPlayEventPatch(userId, id, body)
})
