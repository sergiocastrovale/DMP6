import { prisma } from '~/server/utils/prisma'
import { invalidateSettingsCache } from '~/server/utils/settingsCache'
import { requirePermission } from '~/server/utils/permissions'
import { maskSettingsSecrets, parseSecretField } from '~/server/utils/settingsSecrets'
import { parseNullableInt } from '~/server/utils/settingsFields'

const INT_FIELDS = [
  'downloadMinBitrate', 'autoScanIntervalHours',
  'monitorIntervalMin', 'monitorCap', 'monitorGapsHours', 'retryCooldownDays',
  'noProgressSec', 'maxDownloadAttempts', 'maxConcurrentDownloads',
  'searchPicksPerInterval', 'searchIntervalSec', 'gapsPicksPerRun', 'gapsIntervalMin',
] as const

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')

  const body = await readBody(event)

  // Parse all nullable-int fields up front and reject the whole request on the first invalid one -
  // previously a non-numeric value became NaN and either silently cleared a 0 (`|| null`) or was
  // passed straight to Prisma, throwing an unhandled 500 (audit #85).
  const ints: Record<string, number | null | undefined> = {}
  for (const field of INT_FIELDS) {
    const parsed = parseNullableInt(body[field])
    if (!parsed.ok) {
      throw createError({ statusCode: 400, statusMessage: `Invalid ${field}: must be a number` })
    }
    ints[field] = parsed.value
  }

  const data = {
    musicDir: body.musicDir ?? undefined,
    autoScanEnabled: typeof body.autoScanEnabled === 'boolean' ? body.autoScanEnabled : body.autoScanEnabled === null ? null : undefined,
    autoScanIntervalHours: ints.autoScanIntervalHours,
    slskdUrl: body.slskdUrl ?? undefined,
    slskdApiKey: parseSecretField(body.slskdApiKey),
    downloadsPath: body.downloadsPath ?? undefined,
    downloadDirTemplate: body.downloadDirTemplate ?? undefined,
    downloadFormats: body.downloadFormats ?? undefined,
    downloadMinBitrate: ints.downloadMinBitrate,
    downloadsEnabled: typeof body.downloadsEnabled === 'boolean' ? body.downloadsEnabled : body.downloadsEnabled === null ? null : undefined,
    // Monitoring knobs (null clears the override -> env/default)
    monitorEnabled: typeof body.monitorEnabled === 'boolean' ? body.monitorEnabled : body.monitorEnabled === null ? null : undefined,
    monitorIntervalMin: ints.monitorIntervalMin,
    monitorCap: ints.monitorCap,
    monitorGapsHours: ints.monitorGapsHours,
    retryCooldownDays: ints.retryCooldownDays,
    noProgressSec: ints.noProgressSec,
    maxDownloadAttempts: ints.maxDownloadAttempts,
    songkongEnabled: typeof body.songkongEnabled === 'boolean' ? body.songkongEnabled : body.songkongEnabled === null ? null : undefined,
    // Always-on downloader knobs
    autoMergeDownloads: typeof body.autoMergeDownloads === 'boolean' ? body.autoMergeDownloads : body.autoMergeDownloads === null ? null : undefined,
    maxConcurrentDownloads: ints.maxConcurrentDownloads,
    searchPicksPerInterval: ints.searchPicksPerInterval,
    searchIntervalSec: ints.searchIntervalSec,
    gapsPicksPerRun: ints.gapsPicksPerRun,
    gapsIntervalMin: ints.gapsIntervalMin,
    imageStorage: body.imageStorage ?? undefined,
    storageImageBucket: body.storageImageBucket ?? undefined,
    storageBackupsBucket: body.storageBackupsBucket ?? undefined,
    awsRegion: body.awsRegion ?? undefined,
    awsAccessKeyId: body.awsAccessKeyId ?? undefined,
    awsSecretAccessKey: parseSecretField(body.awsSecretAccessKey),
    storageEndpoint: body.storageEndpoint ?? undefined,
    storagePublicUrl: body.storagePublicUrl ?? undefined,
    fanartApiKey: body.fanartApiKey ?? undefined,
    lastfmApiKey: body.lastfmApiKey ?? undefined,
    lastfmSecret: parseSecretField(body.lastfmSecret),
    lastfmSessionKey: parseSecretField(body.lastfmSessionKey),
    lastfmUsername: body.lastfmUsername ?? undefined,
    showTerminal: typeof body.showTerminal === 'boolean' ? body.showTerminal : body.showTerminal === null ? null : undefined,
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

  return maskSettingsSecrets(settings)
})
