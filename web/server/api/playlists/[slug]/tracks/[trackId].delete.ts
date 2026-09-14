import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId, findOwnManualPlaylist } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.crud')
  const userId = currentUserId(event)

  const slug = getRouterParam(event, 'slug')
  const trackId = getRouterParam(event, 'trackId')

  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing playlist slug',
    })
  }

  if (!trackId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing track ID',
    })
  }

  const playlist = await findOwnManualPlaylist(slug, userId)

  // Delete the track from the playlist
  await prisma.playlistTrack.deleteMany({
    where: {
      playlistId: playlist.id,
      trackId,
    },
  })

  return { success: true, message: 'Track removed from playlist' }
})
