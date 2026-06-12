import { prisma } from '~/server/utils/prisma'
import { createSession } from '~/server/utils/auth'
import { SESSION_MAX_AGE_SECONDS } from '~/helpers/constants'
import { verifyPassword } from '~/server/utils/password'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { username, password } = body ?? {}

  if (!username || !password) {
    throw createError({ statusCode: 400, message: 'Missing credentials' })
  }

  const user = await prisma.user.findUnique({ where: { username } })
  if (!user) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }

  const token = createSession(user.id, user.passwordHash)

  setCookie(event, 'dmp_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  })

  return {
    ok: true,
    mustChangePassword: user.mustChangePassword,
  }
})
