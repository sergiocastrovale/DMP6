import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const stats = await prisma.statistics.findUnique({
    where: { id: 'main' },
    select: { scanPid: true, scanLockedBy: true },
  })

  if (stats?.scanPid) {
    try {
      process.kill(stats.scanPid, 'SIGTERM')
    }
    catch { /* pid already dead — that's fine */ }
  }

  await prisma.statistics.update({
    where: { id: 'main' },
    data: { scanLockedBy: null, scanLockedAt: null, scanPid: null },
  })

  return { ok: true }
})
