import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { hashPassword } from '~/server/utils/password'
import { destroyUserSessions } from '~/server/utils/auth'
import { invalidateAuthUserCache } from '~/server/utils/userCache'
import { readBodyOf } from '~/server/utils/requestValidation'
import { updateUserBodySchema } from '~/server/schemas/users'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'users.manage')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, message: 'Invalid id' })
  }

  const { email, role, password } = await readBodyOf(event, updateUserBodySchema)

  const data: Record<string, unknown> = {}

  if (email !== undefined) {
    data.email = email
  }

  if (role !== undefined) {
    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) {throw createError({ statusCode: 404, message: 'User not found' })}
    if (target.role === 'ADMIN' && role !== 'ADMIN') {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } })
      if (adminCount <= 1) {
        throw createError({ statusCode: 400, message: 'Cannot demote last admin' })
      }
    }
    data.role = role
  }

  if (password !== undefined) {
    data.passwordHash = await hashPassword(password)
    data.mustChangePassword = true
    await destroyUserSessions(id)
  }

  if (Object.keys(data).length === 0) {
    throw createError({ statusCode: 400, message: 'No fields to update' })
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      mustChangePassword: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  // Role/email changes should take effect promptly, not sit behind the 30s auth-user cache TTL.
  invalidateAuthUserCache(id)

  return updated
})
