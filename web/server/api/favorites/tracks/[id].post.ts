import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing track ID',
    })
  }

  // Check if already favorited
  const existing = await prisma.favoriteTrack.findUnique({
    where: {
      trackId: id,
    },
  })

  if (existing) {
    return { success: true, message: 'Already favorited' }
  }

  // Create favorite
  await prisma.favoriteTrack.create({
    data: {
      trackId: id,
    },
  })

  return { success: true, message: 'Track favorited' }
})
