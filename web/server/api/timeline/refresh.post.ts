import { prisma } from '~/server/utils/prisma'
import { invalidateCache } from '~/server/utils/cache'

export default defineEventHandler(async () => {
  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY dmp_timeline`
  await invalidateCache('timeline:*')
  return { ok: true }
})
