import { currentUserId } from '~/server/utils/libraryOwnership'
import { touchPresence, setNowPlaying } from '~/server/utils/presence'
import { describeUserAgent } from '~/helpers/functions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { presenceBodySchema } from '~/server/schemas/presence'

// Heartbeat from composables/usePresenceHeartbeat.ts - any logged-in user, no extra permission
// beyond the session the auth middleware already required. trackId is trusted only as a lookup key -
// server/api/users/presence.get.ts resolves title/artist/album from the DB, never echoes it back.
export default defineEventHandler(async (event) => {
  const userId = currentUserId(event)
  const { clientId, trackId, playing } = await readBodyOf(event, presenceBodySchema)

  const clientLabel = describeUserAgent(getRequestHeader(event, 'user-agent'))
  touchPresence({ userId, clientId, client: 'web', clientLabel })
  setNowPlaying(userId, clientId, trackId ? { trackId, playing: !!playing } : null)

  return { ok: true }
})
