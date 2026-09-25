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
    // A LocalRelease id favorites that release; failing that, an id that is a dissolved box's
    // MusicBrainzRelease (its discs' boxReleaseId) favorites the box itself - one row, not one per disc.
    const isBox = !(await prisma.localRelease.findUnique({ where: { id }, select: { id: true } }))
      && !!(await prisma.localRelease.findFirst({ where: { boxReleaseId: id }, select: { id: true } }))
    if (isBox) {
      await prisma.favoriteRelease.upsert({
        where: { userId_boxReleaseId: { userId, boxReleaseId: id } },
        create: { userId, boxReleaseId: id },
        update: {},
      })
    }
    else {
      await prisma.favoriteRelease.upsert({
        where: { userId_releaseId: { userId, releaseId: id } },
        create: { userId, releaseId: id },
        update: {},
      })
    }
  }
  catch (e) {
    if (isForeignKeyError(e)) {
      throw createError({ statusCode: 404, statusMessage: 'Release not found' })
    }
    throw e
  }

  return { success: true, message: 'Release favorited' }
})
