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
    downloadsPath: body.downloadsPath ?? undefined,
    downloadDirTemplate: body.downloadDirTemplate ?? undefined,
    downloadFormats: body.downloadFormats ?? undefined,
    downloadMinBitrate: body.downloadMinBitrate != null ? Number(body.downloadMinBitrate) || null : undefined,
    requireApprovalForDownloads: typeof body.requireApprovalForDownloads === 'boolean' ? body.requireApprovalForDownloads : undefined,
    // Monitoring knobs (null clears the override -> env/default)
    monitorEnabled: typeof body.monitorEnabled === 'boolean' ? body.monitorEnabled : body.monitorEnabled === null ? null : undefined,
    monitorIntervalMin: body.monitorIntervalMin !== undefined ? (body.monitorIntervalMin === null || body.monitorIntervalMin === '' ? null : Number(body.monitorIntervalMin)) : undefined,
    monitorCap: body.monitorCap !== undefined ? (body.monitorCap === null || body.monitorCap === '' ? null : Number(body.monitorCap)) : undefined,
    monitorGapsHours: body.monitorGapsHours !== undefined ? (body.monitorGapsHours === null || body.monitorGapsHours === '' ? null : Number(body.monitorGapsHours)) : undefined,
    monitorRetryHours: body.monitorRetryHours !== undefined ? (body.monitorRetryHours === null || body.monitorRetryHours === '' ? null : Number(body.monitorRetryHours)) : undefined,
    noProgressSec: body.noProgressSec !== undefined ? (body.noProgressSec === null || body.noProgressSec === '' ? null : Number(body.noProgressSec)) : undefined,
    maxDownloadAttempts: body.maxDownloadAttempts !== undefined ? (body.maxDownloadAttempts === null || body.maxDownloadAttempts === '' ? null : Number(body.maxDownloadAttempts)) : undefined,
    songkongEnabled: typeof body.songkongEnabled === 'boolean' ? body.songkongEnabled : body.songkongEnabled === null ? null : undefined,
    imageStorage: body.imageStorage ?? undefined,
    storageImageBucket: body.storageImageBucket ?? undefined,
    storageBackupsBucket: body.storageBackupsBucket ?? undefined,
    awsRegion: body.awsRegion ?? undefined,
    awsAccessKeyId: body.awsAccessKeyId ?? undefined,
    awsSecretAccessKey: body.awsSecretAccessKey ?? undefined,
    storageEndpoint: body.storageEndpoint ?? undefined,
    storagePublicUrl: body.storagePublicUrl ?? undefined,
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
