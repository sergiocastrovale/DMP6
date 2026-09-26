import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { invalidateSettingsCache } from '~/server/utils/settingsCache'
import { getLastfmSession } from '~/server/utils/lastfm'
import { OAUTH_STATE_COOKIE, oauthStatesMatch } from '~/server/utils/oauthState'

export default defineEventHandler(async (event) => {
  // Matches connect.get.ts (which starts this OAuth flow) - Settings is a single shared row, so
  // completing this callback overwrites the site's ONE scrobble session. Without this, any
  // authenticated user who supplies their own valid Last.fm token here could hijack it (audit #81).
  await requirePermission(event, 'variables.edit')

  // Bound to the browser that started the flow (see server/utils/oauthState.ts): without a matching nonce this is a
  // forged link, however valid the token in it is.
  const state = getRouterParam(event, 'state')
  if (!oauthStatesMatch(state, getCookie(event, OAUTH_STATE_COOKIE))) {
    throw createError({ statusCode: 400, message: 'Last.fm connection was not started from this browser - start it again from Settings' })
  }
  deleteCookie(event, OAUTH_STATE_COOKIE, { path: '/api/scrobble' })

  const query = getQuery(event)
  const token = query.token as string | undefined

  if (!token) {
    throw createError({ statusCode: 400, message: 'Missing token' })
  }

  // Straight from the DB, not settingsCache: same reasoning as connect.get.ts - this runs once,
  // right after the settings form just saved the key/secret, and the cache's staleness window
  // could still serve the pre-save (null) values here.
  const settings = await prisma.settings.findUnique({ where: { id: 'main' } })
  const lastfmApiKey = settings?.lastfmApiKey || process.env.LASTFM_API_KEY
  const lastfmSecret = settings?.lastfmSecret || process.env.LASTFM_SECRET
  if (!lastfmApiKey || !lastfmSecret) {
    throw createError({ statusCode: 400, message: 'Last.fm not configured' })
  }

  const session = await getLastfmSession(token, lastfmApiKey, lastfmSecret)
  if (!session) {
    throw createError({ statusCode: 400, message: 'Failed to get Last.fm session' })
  }

  await prisma.settings.upsert({
    where: { id: 'main' },
    create: {
      lastfmApiKey,
      lastfmSecret,
      lastfmSessionKey: session.sessionKey,
      lastfmUsername: session.username,
    },
    update: {
      lastfmSessionKey: session.sessionKey,
      lastfmUsername: session.username,
    },
  })

  invalidateSettingsCache()

  return sendRedirect(event, '/settings/api-keys')
})
