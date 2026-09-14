import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.crud')
  const userId = currentUserId(event)

  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing track ID',
    })
  }

  await prisma.favoriteTrack.deleteMany({
    where: { userId, trackId: id },
  })

  return { success: true, message: 'Track unfavorited' }
})
