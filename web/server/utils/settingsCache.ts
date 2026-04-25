import { prisma } from '~/server/utils/prisma'

export interface CachedSettings {
  musicDir: string
  imageStorage: string
  s3ImageBucket: string
  s3BackupsBucket: string
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
  s3Endpoint: string
  s3PublicUrl: string
  fanartApiKey: string
}

const CACHE_TTL = 30_000

let cache: CachedSettings | null = null
let cacheExpiry = 0

function defaults(): CachedSettings {
  return {
    musicDir: process.env.MUSIC_DIR || '',
    imageStorage: process.env.IMAGE_STORAGE || 'local',
    s3ImageBucket: process.env.S3_IMAGE_BUCKET || '',
    s3BackupsBucket: process.env.S3_BACKUPS_BUCKET || '',
    awsRegion: process.env.AWS_REGION || '',
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    s3Endpoint: process.env.S3_ENDPOINT || '',
    s3PublicUrl: process.env.S3_PUBLIC_URL || '',
    fanartApiKey: process.env.FANART_API_KEY || '',
  }
}

async function refreshCache(): Promise<void> {
  try {
    const s = await prisma.settings.findUnique({ where: { id: 'main' } })
    const d = defaults()
    cache = {
      musicDir: s?.musicDir || d.musicDir,
      imageStorage: s?.imageStorage || d.imageStorage,
      s3ImageBucket: s?.s3ImageBucket || d.s3ImageBucket,
      s3BackupsBucket: s?.s3BackupsBucket || d.s3BackupsBucket,
      awsRegion: s?.awsRegion || d.awsRegion,
      awsAccessKeyId: s?.awsAccessKeyId || d.awsAccessKeyId,
      awsSecretAccessKey: s?.awsSecretAccessKey || d.awsSecretAccessKey,
      s3Endpoint: s?.s3Endpoint || d.s3Endpoint,
      s3PublicUrl: s?.s3PublicUrl || d.s3PublicUrl,
      fanartApiKey: s?.fanartApiKey || d.fanartApiKey,
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
