import type { Role } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'
import { hashPassword } from '~/server/utils/password'

const VALID_ROLES: Role[] = ['VIEWER', 'MANAGER', 'ADMIN']

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const body = (await readBody(event)) ?? {}
  const { username, email, password, role } = body

  if (!username || !email || !password) {
    throw createError({ statusCode: 400, message: 'Missing fields' })
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw createError({ statusCode: 400, message: 'Password must be at least 6 characters' })
  }

  const finalRole: Role = VALID_ROLES.includes(role) ? role : 'VIEWER'

  const exists = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
  })
  if (exists) {
    throw createError({ statusCode: 409, message: 'Username or email already exists' })
  }

  const created = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash: await hashPassword(password),
      role: finalRole,
      mustChangePassword: true,
    },
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

  return created
})
