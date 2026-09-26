import { prisma } from '~/server/utils/prisma'
import { hashPassword, verifyPassword } from '~/server/utils/password'
import { createSession } from '~/server/utils/auth'
import { SESSION_MAX_AGE_SECONDS } from '~/helpers/constants'
import { invalidateAuthUserCache } from '~/server/utils/userCache'
import { readBodyOf } from '~/server/utils/requestValidation'
import { changePasswordBodySchema } from '~/server/schemas/auth'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const { currentPassword, newPassword } = await readBodyOf(event, changePasswordBodySchema)

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (!dbUser) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const ok = await verifyPassword(currentPassword, dbUser.passwordHash)
  if (!ok) {
    throw createError({ statusCode: 401, message: 'Current password incorrect' })
  }

  const newHash = await hashPassword(newPassword)

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash, mustChangePassword: false },
  })
  invalidateAuthUserCache(user.id)

  setCookie(event, 'dmp_session', createSession(user.id, newHash, dbUser.tokenVersion), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  })

  return { ok: true }
})
