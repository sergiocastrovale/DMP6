import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.crud')

  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing release ID',
    })
  }

  // Delete favorite
  await prisma.favoriteRelease.delete({
    where: {
      releaseId: id,
    },
  })

  return { success: true, message: 'Release unfavorited' }
})
