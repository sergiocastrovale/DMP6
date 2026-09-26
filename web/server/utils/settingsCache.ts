import type { Settings } from '@prisma/client'
import type { CachedSettings } from '~/types/api'
import { invalidateSettings, peekSettingsRow, getSettingsRow, refreshSettings, settingsStale, envMusicDir } from '~/server/utils/settings'

// Synchronous DB → env view of the settings the request paths need (storage, keys, Last.fm, Genius). The row itself
// comes from server/utils/settings.ts; server/middleware/00.settingsReady.ts makes sure it has loaded before the
// first request is served, so the env-only fallback below is just a database that was unreachable at boot.

const fromRow = (s: Settings | null): CachedSettings => ({
  musicDir: s?.musicDir || envMusicDir(),
  imageStorage: s?.imageStorage || process.env.IMAGE_STORAGE || 'local',
  storageImageBucket: s?.storageImageBucket || process.env.STORAGE_IMAGE_BUCKET || '',
  storageBackupsBucket: s?.storageBackupsBucket || process.env.STORAGE_BACKUPS_BUCKET || '',
  awsRegion: s?.awsRegion || process.env.AWS_REGION || '',
  awsAccessKeyId: s?.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
  awsSecretAccessKey: s?.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '',
  storageEndpoint: s?.storageEndpoint || process.env.STORAGE_ENDPOINT || '',
  storagePublicUrl: s?.storagePublicUrl || process.env.STORAGE_PUBLIC_URL || '',
  fanartApiKey: s?.fanartApiKey || process.env.FANART_API_KEY || '',
  geniusClientId: s?.geniusClientId || process.env.GENIUS_CLIENT_ID || null,
  geniusSecret: s?.geniusSecret || process.env.GENIUS_SECRET || null,
  geniusAccessToken: s?.geniusAccessToken || process.env.GENIUS_ACCESS_TOKEN || null,
  lastfmApiKey: s?.lastfmApiKey || process.env.LASTFM_API_KEY || null,
  lastfmSecret: s?.lastfmSecret || process.env.LASTFM_SECRET || null,
  lastfmSessionKey: s?.lastfmSessionKey || process.env.LASTFM_SESSION_KEY || null,
  lastfmUsername: s?.lastfmUsername || process.env.LASTFM_USERNAME || null,
})

export const getCachedSettings = (): CachedSettings => {
  // Serve the last loaded row and refresh behind it; before the first load that is the env values.
  if (settingsStale()) {
    getSettingsRow().catch(() => {})
  }
  return fromRow(peekSettingsRow() ?? null)
}

export const invalidateSettingsCache = (): void => {
  invalidateSettings()
}

// Awaitable counterpart: the very next getCachedSettings() reflects a just-written row.
export const refreshSettingsCache = async (): Promise<void> => {
  await refreshSettings()
}
