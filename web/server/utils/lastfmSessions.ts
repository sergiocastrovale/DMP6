import { prisma } from '~/server/utils/prisma'
import { getSettingsRow } from '~/server/utils/settings'
import { decryptSecret, encryptSecret } from '~/server/utils/secretBox'

// A Last.fm session belongs to the account that authorised it, so it is stored per user (UserLastfmSession) and only
// the application's API key and shared secret stay global (Settings.lastfmApiKey / lastfmSecret, env fallback).

export interface UserLastfmSession {
  sessionKey: string
  username: string
}

export const getUserLastfmSession = async (userId: number): Promise<UserLastfmSession | null> => {
  const row = await prisma.userLastfmSession.findUnique({ where: { userId }, select: { sessionKey: true, username: true } })
  // Stored encrypted when SETTINGS_ENCRYPTION_KEY is set; one that cannot be opened counts as not connected.
  const sessionKey = row ? decryptSecret(row.sessionKey) : null
  return row && sessionKey ? { sessionKey, username: row.username } : null
}

export const saveUserLastfmSession = async (userId: number, session: UserLastfmSession): Promise<void> => {
  const stored = { sessionKey: encryptSecret(session.sessionKey), username: session.username }
  await prisma.userLastfmSession.upsert({
    where: { userId },
    create: { userId, ...stored },
    update: { ...stored, createdAt: new Date() },
  })
}

export const deleteUserLastfmSession = async (userId: number): Promise<void> => {
  await prisma.userLastfmSession.deleteMany({ where: { userId } })
}

// The application credentials. `fresh` for the connect flow, which runs once right after an admin may have typed the key
// and must not see a stale "not configured".
export const lastfmAppCredentials = async (fresh = false): Promise<{ apiKey: string | null, secret: string | null }> => {
  const row = await getSettingsRow({ fresh }).catch(() => null)
  return {
    apiKey: row?.lastfmApiKey || process.env.LASTFM_API_KEY || null,
    secret: row?.lastfmSecret || process.env.LASTFM_SECRET || null,
  }
}
