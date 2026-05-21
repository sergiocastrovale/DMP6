import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const body = await readBody<{ ids?: string[] }>(event).catch((): { ids?: string[] } => ({}))
  const ids = body?.ids

  const where = Array.isArray(ids) && ids.length > 0
    ? { id: { in: ids } }
    : {}

  const result = await prisma.fixHistory.deleteMany({ where })

  return { deleted: result.count }
})
