import { prisma } from '~/server/utils/prisma'
import { redis } from '~/server/utils/redis'
import { checkHealth } from '~/server/utils/health'

// Public (see server/middleware/auth.ts), so it answers with a bare flag and never a detail. The default is a
// liveness check that touches nothing; `?deep=1` also asks the database and is what the container healthcheck uses,
// so a wedged connection pool turns the container unhealthy instead of serving 500s behind a green light.
export default defineEventHandler(async (event) => {
  if (!getQuery(event).deep) {
    return { ok: true }
  }
  const result = await checkHealth({
    pingDatabase: () => prisma.$queryRaw`SELECT 1`,
    pingRedis: redis ? () => redis!.ping() : undefined,
  })
  if (!result.ok) {
    setResponseStatus(event, 503)
  }
  return result
})
