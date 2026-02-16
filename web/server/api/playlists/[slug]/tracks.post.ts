import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')

  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing playlist slug',
    })
  }

  const body = await readBody(event)

  if (!body.trackId || typeof body.trackId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid track ID',
    })
  }

  const playlist = await prisma.playlist.findUnique({
    where: { slug },
    include: {
      tracks: {
        orderBy: { position: 'desc' },
        take: 1,
      },
    },
  })

  if (!playlist) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Playlist not found',
    })
  }

  // Get next position
  const nextPosition = playlist.tracks.length > 0 ? playlist.tracks[0].position + 1 : 0

  // Add track to playlist
  const playlistTrack = await prisma.playlistTrack.create({
    data: {
      playlistId: playlist.id,
      trackId: body.trackId,
      position: nextPosition,
    },
  })

  return {
    success: true,
    message: 'Track added to playlist',
    playlistTrack: {
      id: playlistTrack.id,
      position: playlistTrack.position,
      addedAt: playlistTrack.createdAt,
    },
  }
})
