import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY dmp_timeline`
  return { ok: true }
})
