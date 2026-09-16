import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { listApiKeys } from '~/server/utils/apiKeys'

// Gated on play.view (every role that can play music can also generate a Subsonic key for it -
// there's no dedicated permission key for this, same reasoning as favorites/playlists reusing
// play.view rather than inventing a one-off).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const userId = currentUserId(event)
  return listApiKeys(userId)
})
