import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing track ID',
    })
  }

  // Delete favorite
  await prisma.favoriteTrack.delete({
    where: {
      trackId: id,
    },
  })

  return { success: true, message: 'Track unfavorited' }
})
