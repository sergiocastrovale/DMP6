import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { invalidateCache } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.run')

  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY dmp_timeline`
  await invalidateCache('timeline:*')
  return { ok: true }
})
