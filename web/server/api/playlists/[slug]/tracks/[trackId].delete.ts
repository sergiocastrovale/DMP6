import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.crud')

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

  const playlist = await prisma.playlist.findUnique({
    where: { slug },
  })

  if (!playlist) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Playlist not found',
    })
  }

  if (playlist.type === 'GENRE') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cannot remove tracks from generated playlists',
    })
  }

  // Delete the track from the playlist
  await prisma.playlistTrack.deleteMany({
    where: {
      playlistId: playlist.id,
      trackId,
    },
  })

  return { success: true, message: 'Track removed from playlist' }
})
