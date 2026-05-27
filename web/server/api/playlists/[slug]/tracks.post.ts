import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.crud')

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
    select: { id: true, type: true },
  })

  if (!playlist) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Playlist not found',
    })
  }

  if (playlist.type !== 'MANUAL') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cannot add tracks to generated playlists',
    })
  }

  const playlistTrack = await prisma.$transaction(async (tx) => {
    const top = await tx.playlistTrack.findFirst({
      where: { playlistId: playlist.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    })
    return tx.playlistTrack.create({
      data: {
        playlistId: playlist.id,
        trackId: body.trackId,
        position: (top?.position ?? -1) + 1,
      },
    })
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
