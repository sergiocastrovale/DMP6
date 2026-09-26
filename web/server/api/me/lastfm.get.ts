import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { getUserLastfmSession, lastfmAppCredentials } from '~/server/utils/lastfmSessions'

// The signed-in user's Last.fm state for Settings → Last.fm. `available` is whether an admin has set the application key
// and secret up at all; the session key itself never leaves the server.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const [session, { apiKey, secret }] = await Promise.all([
    getUserLastfmSession(currentUserId(event)),
    lastfmAppCredentials(),
  ])
  return { available: !!(apiKey && secret), connected: !!session, username: session?.username ?? null }
})
