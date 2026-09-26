import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { getLastfmSession } from '~/server/utils/lastfm'
import { lastfmAppCredentials, saveUserLastfmSession } from '~/server/utils/lastfmSessions'
import { OAUTH_STATE_COOKIE, oauthStatesMatch } from '~/server/utils/oauthState'

export default defineEventHandler(async (event) => {
  // Matches connect.get.ts. The session is saved against the signed-in user, so a forged link could otherwise bind
  // that user's scrobbles to an attacker's Last.fm account (audit #81) - the nonce below is what rules that out.
  await requirePermission(event, 'play.view')

  // Bound to the browser that started the flow (see server/utils/oauthState.ts): without a matching nonce this is a
  // forged link, however valid the token in it is.
  const state = getRouterParam(event, 'state')
  if (!oauthStatesMatch(state, getCookie(event, OAUTH_STATE_COOKIE))) {
    throw createError({ statusCode: 400, message: 'Last.fm connection was not started from this browser - start it again from Settings' })
  }
  deleteCookie(event, OAUTH_STATE_COOKIE, { path: '/api/scrobble' })

  const token = getQuery(event).token as string | undefined
  if (!token) {
    throw createError({ statusCode: 400, message: 'Missing token' })
  }

  const { apiKey, secret } = await lastfmAppCredentials(true)
  if (!apiKey || !secret) {
    throw createError({ statusCode: 400, message: 'Last.fm not configured' })
  }

  const session = await getLastfmSession(token, apiKey, secret)
  if (!session) {
    throw createError({ statusCode: 400, message: 'Failed to get Last.fm session' })
  }

  await saveUserLastfmSession(currentUserId(event), session)

  return sendRedirect(event, '/settings/lastfm')
})
