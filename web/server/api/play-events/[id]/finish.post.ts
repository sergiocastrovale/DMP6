import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { applyPlayEventPatch } from '~/server/utils/playEvents'

// sendBeacon-only twin of ../[id].patch.ts - beacon can only POST, and browsers only guarantee it
// fires reliably on page hide, not a regular PATCH. Same body shape, same handler.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const userId = currentUserId(event)

  const id = getRouterParam(event, 'id')
  if (!id) {throw createError({ statusCode: 400, statusMessage: 'Missing id' })}

  const raw = await readRawBody(event, 'utf8')
  const body = raw ? JSON.parse(raw) : {}

  return applyPlayEventPatch(userId, id, body)
})
