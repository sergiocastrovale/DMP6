import { lastfmAppCredentials } from '~/server/utils/lastfmSessions'
import { requirePermission } from '~/server/utils/permissions'
import { getAuthUrl } from '~/server/utils/lastfm'
import { createOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from '~/server/utils/oauthState'

export default defineEventHandler(async (event) => {
  // Any listener connects their own account; the application key it goes through is the admin's (Settings).
  await requirePermission(event, 'play.view')

  const { apiKey: lastfmApiKey } = await lastfmAppCredentials(true)
  if (!lastfmApiKey) {
    throw createError({ statusCode: 400, message: 'Last.fm is not set up - ask an admin to add the API key in Settings' })
  }

  // The nonce rides in the callback PATH (Last.fm appends ?token=... itself, so a query string of ours would be
  // at its mercy) and in an httpOnly cookie; the callback requires both to match (server/utils/oauthState.ts).
  const state = createOAuthState()
  setCookie(event, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    path: '/api/scrobble',
  })

  const requestUrl = getRequestURL(event)
  const callbackUrl = `${requestUrl.origin}/api/scrobble/callback/${state}`

  return { url: getAuthUrl(lastfmApiKey, callbackUrl) }
})
