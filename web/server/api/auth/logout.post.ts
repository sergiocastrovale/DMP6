import { destroySession } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'dmp_session')
  if (token) {await destroySession(token)}
  deleteCookie(event, 'dmp_session', { path: '/' })
  return { ok: true }
})
