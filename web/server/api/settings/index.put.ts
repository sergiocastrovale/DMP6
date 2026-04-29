import { prisma } from '~/server/utils/prisma'
import { invalidateSettingsCache } from '~/server/utils/settingsCache'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')

  const body = await readBody(event)

  const data = {
    musicDir: body.musicDir ?? undefined,
    slskdUrl: body.slskdUrl ?? undefined,
    slskdApiKey: body.slskdApiKey ?? undefined,
    deezerArl: body.deezerArl ?? undefined,
    downloadsPath: body.downloadsPath ?? undefined,
    downloadDirTemplate: body.downloadDirTemplate ?? undefined,
    downloadFormats: body.downloadFormats ?? undefined,
    downloadMinBitrate: body.downloadMinBitrate != null ? Number(body.downloadMinBitrate) || null : undefined,
    imageStorage: body.imageStorage ?? undefined,
    s3ImageBucket: body.s3ImageBucket ?? undefined,
    s3BackupsBucket: body.s3BackupsBucket ?? undefined,
    awsRegion: body.awsRegion ?? undefined,
    awsAccessKeyId: body.awsAccessKeyId ?? undefined,
    awsSecretAccessKey: body.awsSecretAccessKey ?? undefined,
    s3Endpoint: body.s3Endpoint ?? undefined,
    s3PublicUrl: body.s3PublicUrl ?? undefined,
    fanartApiKey: body.fanartApiKey ?? undefined,
    lastfmApiKey: body.lastfmApiKey ?? undefined,
    lastfmSecret: body.lastfmSecret ?? undefined,
    lastfmSessionKey: body.lastfmSessionKey ?? undefined,
    lastfmUsername: body.lastfmUsername ?? undefined,
  }

  // Remove undefined keys
  const clean = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  )

  const settings = await prisma.settings.upsert({
    where: { id: 'main' },
    update: clean,
    create: { id: 'main', ...clean },
  })

  invalidateSettingsCache()

  return settings
})
