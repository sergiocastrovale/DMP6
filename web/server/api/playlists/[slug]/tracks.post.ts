import { appendPlaylistTrack } from '~/server/utils/playlistWrites'
import { requirePermission } from '~/server/utils/permissions'
import { isForeignKeyError, isUniqueConstraintError } from '~/server/utils/prismaErrors'
import { readBodyOf } from '~/server/utils/requestValidation'
import { addPlaylistTrackBodySchema } from '~/server/schemas/playlists'
import { currentUserId, findOwnManualPlaylist } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.crud')
  const userId = currentUserId(event)

  const slug = getRouterParam(event, 'slug')

  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing playlist slug',
    })
  }

  const body = await readBodyOf(event, addPlaylistTrackBodySchema)

  const playlist = await findOwnManualPlaylist(slug, userId)

  let playlistTrack
  try {
    playlistTrack = await appendPlaylistTrack(playlist.id, body.trackId)
  }
  catch (e) {
    if (isUniqueConstraintError(e)) {
      throw createError({ statusCode: 409, statusMessage: 'Track is already in this playlist' })
    }
    if (isForeignKeyError(e)) {
      throw createError({ statusCode: 404, statusMessage: 'Track not found' })
    }
    throw e
  }

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
