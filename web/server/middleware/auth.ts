import { validateSession } from '~/server/utils/auth'

const SESSION_COOKIE = 'dmp_session'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  // Nuxt internals and static assets — always allow
  if (
    path.startsWith('/_nuxt') ||
    path.startsWith('/__') ||
    path === '/favicon.ico' ||
    path.match(/^\/favicon[^/]*\.(ico|png|svg)$/) ||
    path === '/apple-touch-icon.png' ||
    path === '/robots.txt'
  ) return

  // Public endpoints
  if (path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/health') return
  if (path.startsWith('/img/') || path.startsWith('/api/audio/')) return

  const token = getCookie(event, SESSION_COOKIE)
  const authenticated = validateSession(token)

  // Redirect authenticated users away from /login
  if (path === '/login') {
    if (authenticated) return sendRedirect(event, '/')
    return
  }

  if (!authenticated) {
    // API and WebSocket: return 401
    if (path.startsWith('/api/') || path === '/_ws') {
      throw createError({ statusCode: 401, message: 'Unauthorized' })
    }
    // Page requests: redirect to login
    return sendRedirect(event, '/login')
  }
})
