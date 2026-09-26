import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { deleteUserLastfmSession } from '~/server/utils/lastfmSessions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  await deleteUserLastfmSession(currentUserId(event))
  return { ok: true }
})
