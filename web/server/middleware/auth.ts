import { validateSession, isSessionStaleForUser } from '~/server/utils/auth'
import { getCachedAuthUser } from '~/server/utils/userCache'

const SESSION_COOKIE = 'dmp_session'

const STATIC_PREFIXES = ['/_nuxt', '/__']
const STATIC_FILES = ['/favicon.ico', '/apple-touch-icon.png', '/robots.txt']

const PUBLIC_API = new Set(['/api/auth/login', '/api/auth/logout', '/api/health'])
const PUBLIC_PREFIXES = ['/img/']

const PASSWORD_CHANGE_PAGE = '/change-password'
const PASSWORD_CHANGE_API = '/api/auth/change-password'
const PASSWORD_CHANGE_ALLOWED_API = new Set([
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/me',
])

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  if (STATIC_PREFIXES.some((p) => path.startsWith(p))) {return}
  if (STATIC_FILES.includes(path)) {return}
  if (path.match(/^\/favicon[^/]*\.(ico|png|svg)$/)) {return}

  if (PUBLIC_API.has(path)) {return}
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {return}

  const token = getCookie(event, SESSION_COOKIE)
  const session = validateSession(token)

  if (path === '/login') {
    if (session) {return sendRedirect(event, '/')}
    return
  }

  if (!session) {
    if (path.startsWith('/api/') || path === '/_ws' || path.startsWith('/api/audio/')) {
      throw createError({ statusCode: 401, message: 'Unauthorized' })
    }
    return sendRedirect(event, '/login')
  }

  const dbUser = await getCachedAuthUser(session.userId)

  const invalidSession = !dbUser || isSessionStaleForUser(token, dbUser.passwordHash, dbUser.tokenVersion)
  if (invalidSession) {
    deleteCookie(event, SESSION_COOKIE, { path: '/' })
    if (path.startsWith('/api/')) {
      throw createError({ statusCode: 401, message: 'Unauthorized' })
    }
    return sendRedirect(event, '/login')
  }

  const { passwordHash: _, tokenVersion: __, ...user } = dbUser
  event.context.user = user

  if (user.mustChangePassword) {
    const isApi = path.startsWith('/api/')
    if (isApi && !PASSWORD_CHANGE_ALLOWED_API.has(path)) {
      throw createError({ statusCode: 403, message: 'Password change required' })
    }
    if (!isApi && path !== PASSWORD_CHANGE_PAGE) {
      return sendRedirect(event, PASSWORD_CHANGE_PAGE)
    }
  }
  else if (path === PASSWORD_CHANGE_PAGE) {
    return sendRedirect(event, '/')
  }
})
