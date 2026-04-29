import { requireRole } from '~/server/utils/permissions'
import { getCachedSettings } from '~/server/utils/settingsCache'
import { getAuthUrl } from '~/server/utils/lastfm'

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const settings = await getCachedSettings()
  if (!settings?.lastfmApiKey) {
    throw createError({ statusCode: 400, message: 'Last.fm API key not configured' })
  }

  const requestUrl = getRequestURL(event)
  const callbackUrl = `${requestUrl.origin}/api/scrobble/callback`

  return { url: getAuthUrl(settings.lastfmApiKey, callbackUrl) }
})
