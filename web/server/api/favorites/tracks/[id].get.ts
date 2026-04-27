import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing track ID' })
  }

  const favorite = await prisma.favoriteTrack.findUnique({
    where: { trackId: id },
    select: { id: true },
  })

  return { isFavorite: !!favorite }
})
