import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing release ID',
    })
  }

  await prisma.favoriteRelease.upsert({
    where: { releaseId: id },
    create: { releaseId: id },
    update: {},
  })

  return { success: true, message: 'Release favorited' }
})
