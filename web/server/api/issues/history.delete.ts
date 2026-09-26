import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { optionalIdsBodySchema } from '~/server/schemas/issues'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.admin')

  const { ids } = await readBodyOf(event, optionalIdsBodySchema)

  const where = ids && ids.length > 0
    ? { id: { in: ids } }
    : {}

  const result = await prisma.fixHistory.deleteMany({ where })

  return { deleted: result.count }
})
