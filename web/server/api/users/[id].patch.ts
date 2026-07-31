import type { Role } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'
import { hashPassword } from '~/server/utils/password'
import { destroyUserSessions } from '~/server/utils/auth'
import { invalidateAuthUserCache } from '~/server/utils/userCache'

const VALID_ROLES: Role[] = ['VIEWER', 'MANAGER', 'ADMIN']

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, message: 'Invalid id' })
  }

  const body = (await readBody(event)) ?? {}
  const { email, role, password } = body

  const data: Record<string, unknown> = {}

  if (email !== undefined) {
    if (typeof email !== 'string' || !email) {
      throw createError({ statusCode: 400, message: 'Invalid email' })
    }
    data.email = email
  }

  if (role !== undefined) {
    if (!VALID_ROLES.includes(role)) {
      throw createError({ statusCode: 400, message: 'Invalid role' })
    }
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
    if (typeof password !== 'string' || password.length < 6) {
      throw createError({ statusCode: 400, message: 'Password must be at least 6 characters' })
    }
    data.passwordHash = await hashPassword(password)
    data.mustChangePassword = true
    await destroyUserSessions(id)
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
