import { requirePermission } from '~/server/utils/permissions'
import { invalidateCache } from '~/server/utils/cache'
import { findArtistByMbid } from '~/server/utils/artistByMbid'

// Called by /add's Search.vue right after `./add --mbid <mbid>` exits 0. `./add` writes straight to
// Postgres and can't reach Redis, so the browse cache (2 min TTL) would otherwise show the new artist
// late - this busts it and hands back the slug to navigate to.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.run')

  const mbid = getRouterParam(event, 'mbid')
  if (!mbid) {throw createError({ statusCode: 400, statusMessage: 'Missing mbid' })}

  const artist = await findArtistByMbid(mbid)
  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found after add' })
  }

  await invalidateCache('artists:*')
  return artist
})
