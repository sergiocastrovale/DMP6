import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { favoriteReleaseCard, favoriteReleaseSelect } from '~/server/utils/favorites'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.view')
  const userId = currentUserId(event)

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)

  const favorites = await prisma.favoriteRelease.findMany({
    where: { userId },
    take: limit,
    orderBy: { createdAt: 'desc' },
    select: favoriteReleaseSelect,
  })

  return favorites.map(favoriteReleaseCard).filter(card => card !== null)
})
