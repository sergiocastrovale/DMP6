import type { CachedSettings } from '~/types/api'
import { prisma } from '~/server/utils/prisma'

const CACHE_TTL = 30_000

let cache: CachedSettings | null = null
let cacheExpiry = 0

function defaults(): CachedSettings {
  return {
    musicDir: process.env.MUSIC_DIR || '',
    imageStorage: process.env.IMAGE_STORAGE || 'local',
    storageImageBucket: process.env.STORAGE_IMAGE_BUCKET || '',
    storageBackupsBucket: process.env.STORAGE_BACKUPS_BUCKET || '',
    awsRegion: process.env.AWS_REGION || '',
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    storageEndpoint: process.env.STORAGE_ENDPOINT || '',
    storagePublicUrl: process.env.STORAGE_PUBLIC_URL || '',
    fanartApiKey: process.env.FANART_API_KEY || '',
    lastfmApiKey: process.env.LASTFM_API_KEY || null,
    lastfmSecret: process.env.LASTFM_SECRET || null,
    lastfmSessionKey: process.env.LASTFM_SESSION_KEY || null,
    lastfmUsername: process.env.LASTFM_USERNAME || null,
  }
}

async function refreshCache(): Promise<void> {
  try {
    const s = await prisma.settings.findUnique({ where: { id: 'main' } })
    const d = defaults()
    cache = {
      musicDir: s?.musicDir || d.musicDir,
      imageStorage: s?.imageStorage || d.imageStorage,
      storageImageBucket: s?.storageImageBucket || d.storageImageBucket,
      storageBackupsBucket: s?.storageBackupsBucket || d.storageBackupsBucket,
      awsRegion: s?.awsRegion || d.awsRegion,
      awsAccessKeyId: s?.awsAccessKeyId || d.awsAccessKeyId,
      awsSecretAccessKey: s?.awsSecretAccessKey || d.awsSecretAccessKey,
      storageEndpoint: s?.storageEndpoint || d.storageEndpoint,
      storagePublicUrl: s?.storagePublicUrl || d.storagePublicUrl,
      fanartApiKey: s?.fanartApiKey || d.fanartApiKey,
      lastfmApiKey: s?.lastfmApiKey || d.lastfmApiKey,
      lastfmSecret: s?.lastfmSecret || d.lastfmSecret,
      lastfmSessionKey: s?.lastfmSessionKey || d.lastfmSessionKey,
      lastfmUsername: s?.lastfmUsername || d.lastfmUsername,
    }
    cacheExpiry = Date.now() + CACHE_TTL
  }
  catch {
    // On error, keep stale cache or use defaults
    if (!cache) {
      cache = defaults()
      cacheExpiry = Date.now() + CACHE_TTL
    }
  }
}

export function getCachedSettings(): CachedSettings {
  if (!cache) {
    refreshCache().catch(() => {})
    return defaults()
  }
  if (Date.now() > cacheExpiry) {
    refreshCache().catch(() => {})
  }
  return cache
}

export function invalidateSettingsCache(): void {
  cache = null
  cacheExpiry = 0
}

// Warm cache on module load
refreshCache().catch(() => {})
