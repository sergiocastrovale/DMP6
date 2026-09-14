import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.view')
  const userId = currentUserId(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing track ID' })
  }

  const favorite = await prisma.favoriteTrack.findUnique({
    where: { userId_trackId: { userId, trackId: id } },
    select: { id: true },
  })

  return { isFavorite: !!favorite }
})
