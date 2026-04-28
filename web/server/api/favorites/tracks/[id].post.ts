import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.crud')

  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing track ID',
    })
  }

  await prisma.favoriteTrack.upsert({
    where: { trackId: id },
    create: { trackId: id },
    update: {},
  })

  return { success: true, message: 'Track favorited' }
})
