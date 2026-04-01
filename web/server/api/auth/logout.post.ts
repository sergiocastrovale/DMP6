import { destroySession } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const token = getCookie(event, 'dmp_session')
  if (token) destroySession(token)
  deleteCookie(event, 'dmp_session', { path: '/' })
  return { ok: true }
})
