import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { isForeignKeyError } from '~/server/utils/prismaErrors'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.crud')

  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing track ID',
    })
  }

  try {
    await prisma.favoriteTrack.upsert({
      where: { trackId: id },
      create: { trackId: id },
      update: {},
    })
  }
  catch (e) {
    if (isForeignKeyError(e)) {
      throw createError({ statusCode: 404, statusMessage: 'Track not found' })
    }
    throw e
  }

  return { success: true, message: 'Track favorited' }
})
