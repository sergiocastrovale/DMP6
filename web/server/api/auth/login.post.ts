import { prisma } from '~/server/utils/prisma'
import { createSession } from '~/server/utils/auth'
import { SESSION_MAX_AGE_SECONDS } from '~/helpers/constants'
import { DUMMY_PASSWORD_HASH, verifyPassword } from '~/server/utils/password'
import { clearLoginFailures, isLoginLocked, registerLoginFailure } from '~/server/utils/loginThrottle'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { username, password, rememberMe } = body ?? {}
  // Defaults to true so an existing session's lifetime is unchanged; unchecking it downgrades the
  // cookie to a session one, which the browser drops when it closes.
  const persist = rememberMe !== false

  if (!username || !password) {
    throw createError({ statusCode: 400, message: 'Missing credentials' })
  }

  const throttleKey = `${username}:${getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'}`
  if (isLoginLocked(throttleKey)) {
    throw createError({ statusCode: 429, message: 'Too many attempts — try again shortly' })
  }

  const user = await prisma.user.findUnique({ where: { username } })
  // Always run the bcrypt compare, even for an unknown username, against a fixed dummy hash — timing
  // must not reveal which usernames exist.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
  if (!user || !ok) {
    registerLoginFailure(throttleKey)
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }
  clearLoginFailures(throttleKey)

  const token = createSession(user.id, user.passwordHash, user.tokenVersion)

  setCookie(event, 'dmp_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    // Omitting maxAge entirely is what makes it a session cookie - passing 0 or undefined-as-a-value
    // would expire it immediately instead.
    ...(persist ? { maxAge: SESSION_MAX_AGE_SECONDS } : {}),
    path: '/',
  })

  return {
    ok: true,
    mustChangePassword: user.mustChangePassword,
  }
})
