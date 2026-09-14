import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { isForeignKeyError } from '~/server/utils/prismaErrors'
import { currentUserId } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.crud')
  const userId = currentUserId(event)

  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing release ID',
    })
  }

  try {
    await prisma.favoriteRelease.upsert({
      where: { userId_releaseId: { userId, releaseId: id } },
      create: { userId, releaseId: id },
      update: {},
    })
  }
  catch (e) {
    if (isForeignKeyError(e)) {
      throw createError({ statusCode: 404, statusMessage: 'Release not found' })
    }
    throw e
  }

  return { success: true, message: 'Release favorited' }
})
