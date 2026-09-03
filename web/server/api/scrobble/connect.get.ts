import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'
import { getAuthUrl } from '~/server/utils/lastfm'

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  // Read straight from the DB, not the settingsCache: this handler only runs once, right after
  // the settings form just saved the key, and the cache's 30s staleness window (or an
  // invalidate/refetch race right after that save) previously made a key typed and saved a moment
  // ago look "not configured". Nothing here is on a hot path that needs the cache's savings.
  const settings = await prisma.settings.findUnique({ where: { id: 'main' } })
  const lastfmApiKey = settings?.lastfmApiKey || process.env.LASTFM_API_KEY
  if (!lastfmApiKey) {
    throw createError({ statusCode: 400, message: 'Last.fm API key not configured' })
  }

  const requestUrl = getRequestURL(event)
  const callbackUrl = `${requestUrl.origin}/api/scrobble/callback`

  return { url: getAuthUrl(lastfmApiKey, callbackUrl) }
})
