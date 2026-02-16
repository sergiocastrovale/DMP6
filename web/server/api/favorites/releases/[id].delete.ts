import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
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
