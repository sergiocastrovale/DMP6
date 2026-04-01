import { createSession } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { username, password } = body ?? {}

  const adminUser = process.env.ADMIN_USER
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminUser || !adminPassword) {
    throw createError({ statusCode: 500, message: 'Auth not configured — set ADMIN_USER and ADMIN_PASSWORD' })
  }

  if (!username || !password || username !== adminUser || password !== adminPassword) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }

  const token = createSession()

  setCookie(event, 'dmp_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })

  return { ok: true }
})
