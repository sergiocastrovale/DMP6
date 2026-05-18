import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  await prisma.statistics.update({
    where: { id: 'main' },
    data: {
      scanLockedBy: null,
      scanLockedAt: null,
      scanPid: null,
      updatedAt: new Date(),
    },
  })

  return { ok: true }
})
