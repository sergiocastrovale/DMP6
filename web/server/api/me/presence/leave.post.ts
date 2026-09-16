import { currentUserId } from '~/server/utils/libraryOwnership'
import { clearPresence } from '~/server/utils/presence'

// sendBeacon-only twin of ../presence.post.ts, fired on pagehide (composables/usePresenceHeartbeat.ts)
// so a closed tab drops off the admin panel immediately instead of waiting out PRESENCE_STALE_MS.
// Same beacon-body trick as server/api/play-events/[id]/finish.post.ts - a Blob body isn't JSON
// Content-Type, so readBody won't parse it.
export default defineEventHandler(async (event) => {
  const userId = currentUserId(event)

  const raw = await readRawBody(event, 'utf8')
  const body = raw ? JSON.parse(raw) : {}
  const { clientId } = body as { clientId?: string }

  if (clientId) {
    clearPresence(userId, clientId)
  }

  return { ok: true }
})
