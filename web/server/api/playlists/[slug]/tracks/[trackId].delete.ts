import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
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

  // Delete the track from the playlist
  await prisma.playlistTrack.deleteMany({
    where: {
      playlistId: playlist.id,
      trackId,
    },
  })

  return { success: true, message: 'Track removed from playlist' }
})
