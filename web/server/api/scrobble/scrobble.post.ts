import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { scrobbleBodySchema } from '~/server/schemas/scrobble'
import { scrobbleTrack } from '~/server/utils/scrobble'

// DEPRECATED: a listen is scrobbled by the server the moment it is counted (server/utils/playEvents.ts), so the web
// client no longer posts here. Kept for one release for cached older clients; removed by the dead-code pass (T76).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')

  const { trackId, timestamp } = await readBodyOf(event, scrobbleBodySchema)
  const sent = await scrobbleTrack(trackId, timestamp)

  return sent ? { ok: true } : { ok: true, skipped: true }
})
