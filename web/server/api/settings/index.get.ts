import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')
  const settings = await prisma.settings.findUnique({ where: { id: 'main' } })
  return settings ?? { id: 'main' }
})
