import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.view')
  const userId = currentUserId(event)

  const trackId = getRouterParam(event, 'id')

  if (!trackId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing track ID',
    })
  }

  const entries = await prisma.playlistTrack.findMany({
    where: { trackId, playlist: { userId } },
    select: { playlist: { select: { slug: true } } },
  })

  return entries.map(e => e.playlist.slug)
})
