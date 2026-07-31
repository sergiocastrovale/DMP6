import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'
import { destroyUserSessions } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, message: 'Invalid id' })
  }

  const me = event.context.user!
  if (id === me.id) {
    throw createError({ statusCode: 400, message: 'Cannot delete yourself' })
  }

  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }

  if (target.role === 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } })
    if (adminCount <= 1) {
      throw createError({ statusCode: 400, message: 'Cannot delete last admin' })
    }
  }

  await prisma.user.delete({ where: { id } })
  await destroyUserSessions(id)

  return { ok: true }
})
