import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing release ID',
    })
  }

  // Check if already favorited
  const existing = await prisma.favoriteRelease.findUnique({
    where: {
      releaseId: id,
    },
  })

  if (existing) {
    return { success: true, message: 'Already favorited' }
  }

  // Create favorite
  await prisma.favoriteRelease.create({
    data: {
      releaseId: id,
    },
  })

  return { success: true, message: 'Release favorited' }
})
