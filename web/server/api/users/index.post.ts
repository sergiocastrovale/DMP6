import type { Role } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'
import { hashPassword } from '~/server/utils/password'
import { isValidEmail } from '~/server/utils/validation'
import { isUniqueConstraintError } from '~/server/utils/prismaErrors'

const VALID_ROLES: Role[] = ['VIEWER', 'MANAGER', 'ADMIN']

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const body = (await readBody(event)) ?? {}
  const { username, email, password, role } = body

  if (!username || !email || !password) {
    throw createError({ statusCode: 400, message: 'Missing fields' })
  }
  if (typeof email !== 'string' || !isValidEmail(email)) {
    throw createError({ statusCode: 400, message: 'Invalid email' })
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw createError({ statusCode: 400, message: 'Password must be at least 6 characters' })
  }

  const finalRole: Role = VALID_ROLES.includes(role) ? role : 'VIEWER'

  // No findFirst-then-create pre-check - that's a TOCTOU race (two concurrent requests for the same
  // username/email can both pass the check before either creates). Let the DB's own unique constraint
  // be the single source of truth and map its violation to a clean 409 (audit #91).
  try {
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
  }
  catch (e) {
    if (isUniqueConstraintError(e)) {
      throw createError({ statusCode: 409, message: 'Username or email already exists' })
    }
    throw e
  }
})
