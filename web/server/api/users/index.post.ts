import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { hashPassword } from '~/server/utils/password'
import { readBodyOf } from '~/server/utils/requestValidation'
import { createUserBodySchema } from '~/server/schemas/users'
import { isUniqueConstraintError } from '~/server/utils/prismaErrors'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'users.manage')

  const { username, email, password, role } = await readBodyOf(event, createUserBodySchema)

  // No findFirst-then-create pre-check - that's a TOCTOU race (two concurrent requests for the same
  // username/email can both pass the check before either creates). Let the DB's own unique constraint
  // be the single source of truth and map its violation to a clean 409 (audit #91).
  try {
    const created = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash: await hashPassword(password),
        role,
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
