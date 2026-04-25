import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  const settings = await prisma.settings.findUnique({ where: { id: 'main' } })
  return settings ?? { id: 'main' }
})
