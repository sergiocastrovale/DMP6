import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
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

  const playlist = await findOwnManualPlaylist(slug, userId)

  // Delete playlist and all its tracks
  await prisma.playlist.delete({
    where: { id: playlist.id },
  })

  return { success: true, message: 'Playlist deleted' }
})
