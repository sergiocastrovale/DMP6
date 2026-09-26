import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { getAuthUrl } from '~/server/utils/lastfm'
import { createOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from '~/server/utils/oauthState'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')

  // Read straight from the DB, not the settingsCache: this handler only runs once, right after
  // the settings form just saved the key, and the cache's 30s staleness window (or an
  // invalidate/refetch race right after that save) previously made a key typed and saved a moment
  // ago look "not configured". Nothing here is on a hot path that needs the cache's savings.
  const settings = await prisma.settings.findUnique({ where: { id: 'main' } })
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
