import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
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
