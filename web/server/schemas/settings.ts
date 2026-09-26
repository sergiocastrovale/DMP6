import { z } from 'zod'
import { absolutePathField, urlField } from '~/helpers/settingsValidation'
import { parseNullableInt } from '~/server/utils/settingsFields'
import { parseSecretField } from '~/server/utils/settingsSecrets'

// `undefined` (key absent, or null for a text field) leaves the stored value untouched. A boolean or
// integer `null` clears the override so it falls back to the env default.
const text = z.string().nullish().transform(v => v ?? undefined)
const constrainedText = (field: z.ZodType<string, string>) => z.string().pipe(field).nullish().transform(v => v ?? undefined)
const flag = z.boolean().nullish()
const secret = z.unknown().optional().transform(parseSecretField)

const integer = z.unknown().optional().transform((value, ctx) => {
  const parsed = parseNullableInt(value)
  if (!parsed.ok) {
    ctx.addIssue({ code: 'custom', message: 'must be a number' })
    return z.NEVER
  }
  return parsed.value
})

export const settingsBodySchema = z.object({
  musicDir: constrainedText(absolutePathField),
  autoScanEnabled: flag,
  autoScanIntervalHours: integer,
  slskdUrl: constrainedText(urlField),
  slskdApiKey: secret,
  downloadsPath: text,
  downloadDirTemplate: text,
  downloadFormats: text,
  downloadMinBitrate: integer,
  downloadsEnabled: flag,
  flacToMp3: flag,
  flacToMp3Bitrate: integer,
  monitorEnabled: flag,
  monitorIntervalMin: integer,
  monitorCap: integer,
  monitorGapsHours: integer,
  retryCooldownDays: integer,
  noProgressSec: integer,
  maxDownloadAttempts: integer,
  songkongEnabled: flag,
  autoMergeDownloads: flag,
  maxConcurrentDownloads: integer,
  searchPicksPerInterval: integer,
  searchIntervalSec: integer,
  gapsPicksPerRun: integer,
  gapsIntervalMin: integer,
  imageStorage: text,
  storageImageBucket: text,
  storageBackupsBucket: text,
  awsRegion: text,
  awsAccessKeyId: text,
  awsSecretAccessKey: secret,
  storageEndpoint: constrainedText(urlField),
  storagePublicUrl: constrainedText(urlField),
  fanartApiKey: text,
  geniusClientId: text,
  geniusSecret: secret,
  geniusAccessToken: secret,
  lastfmApiKey: text,
  lastfmSecret: secret,
  lastfmSessionKey: secret,
  lastfmUsername: text,
})
