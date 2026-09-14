import { requirePermission } from '~/server/utils/permissions'
import { findArtistByMbid } from '~/server/utils/artistByMbid'

// Looks up an existing Artist by MusicBrainz id, resolved to its primary artist if it's a connected
// duplicate. Used by /add's Search.vue as a fresh pre-add check (catches another tab/user adding the
// same artist between page load and click - mb-search's own `existing` field can be stale by then).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.run')

  const mbid = getRouterParam(event, 'mbid')
  if (!mbid) {throw createError({ statusCode: 400, statusMessage: 'Missing mbid' })}

  const artist = await findArtistByMbid(mbid)
  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return artist
})
