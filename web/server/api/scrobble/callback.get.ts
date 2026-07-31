import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'
import { getCachedSettings, invalidateSettingsCache  } from '~/server/utils/settingsCache'
import { getLastfmSession } from '~/server/utils/lastfm'

export default defineEventHandler(async (event) => {
  // Matches connect.get.ts (which starts this OAuth flow) - Settings is a single shared row, so
  // completing this callback overwrites the site's ONE scrobble session. Without this, any
  // authenticated user who supplies their own valid Last.fm token here could hijack it (audit #81).
  requireRole(event, 'ADMIN')

  const query = getQuery(event)
  const token = query.token as string | undefined

  if (!token) {
    throw createError({ statusCode: 400, message: 'Missing token' })
  }

  const settings = await getCachedSettings()
  if (!settings?.lastfmApiKey || !settings?.lastfmSecret) {
    throw createError({ statusCode: 400, message: 'Last.fm not configured' })
  }

  const session = await getLastfmSession(token, settings.lastfmApiKey, settings.lastfmSecret)
  if (!session) {
    throw createError({ statusCode: 400, message: 'Failed to get Last.fm session' })
  }

  await prisma.settings.upsert({
    where: { id: 'main' },
    create: {
      lastfmApiKey: settings.lastfmApiKey,
      lastfmSecret: settings.lastfmSecret,
      lastfmSessionKey: session.sessionKey,
      lastfmUsername: session.username,
    },
    update: {
      lastfmSessionKey: session.sessionKey,
      lastfmUsername: session.username,
    },
  })

  invalidateSettingsCache()

  return sendRedirect(event, '/settings/scrobble')
})
