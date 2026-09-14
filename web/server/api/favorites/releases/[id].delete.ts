import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
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

  // deleteMany, not delete: no unique-by-releaseId key exists anymore (favorites are per-user), and
  // a missing row (already unfavorited, or never this user's) should no-op rather than 500.
  await prisma.favoriteRelease.deleteMany({
    where: { userId, releaseId: id },
  })

  return { success: true, message: 'Release unfavorited' }
})
