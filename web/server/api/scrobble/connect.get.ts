import { getSettingsRow } from '~/server/utils/settings'
import { requirePermission } from '~/server/utils/permissions'
import { getAuthUrl } from '~/server/utils/lastfm'
import { createOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from '~/server/utils/oauthState'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')

  // Fresh read, not the cached row: this handler only runs once, right after the settings form saved the key,
  // and a key typed a moment ago must not look "not configured". Nothing here is a hot path.
  const settings = await getSettingsRow({ fresh: true })
  const lastfmApiKey = settings?.lastfmApiKey || process.env.LASTFM_API_KEY
  if (!lastfmApiKey) {
    throw createError({ statusCode: 400, message: 'Last.fm API key not configured' })
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
