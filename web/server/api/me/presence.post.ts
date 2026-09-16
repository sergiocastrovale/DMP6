import { currentUserId } from '~/server/utils/libraryOwnership'
import { touchPresence, setNowPlaying } from '~/server/utils/presence'
import { describeUserAgent } from '~/helpers/functions'

// Heartbeat from composables/usePresenceHeartbeat.ts - any logged-in user, no extra permission
// beyond the session the auth middleware already required. trackId is trusted only as a lookup key -
// server/api/users/presence.get.ts resolves title/artist/album from the DB, never echoes it back.
export default defineEventHandler(async (event) => {
  const userId = currentUserId(event)
  const body = (await readBody(event)) ?? {}
  const { clientId, trackId, playing } = body as {
    clientId?: string
    trackId?: string | null
    playing?: boolean
  }

  if (!clientId || typeof clientId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing clientId' })
  }

  const clientLabel = describeUserAgent(getRequestHeader(event, 'user-agent'))
  touchPresence({ userId, clientId, client: 'web', clientLabel })
  setNowPlaying(userId, clientId, trackId ? { trackId, playing: !!playing } : null)

  return { ok: true }
})
