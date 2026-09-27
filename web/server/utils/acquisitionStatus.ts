import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { getSettingsRow } from '~/server/utils/settings'
import { checkDownloadEnvironment, acquireBlockReasons } from '~/server/utils/downloadEnvironment'
import type { Acquisition, NoYearMissingRelease } from '~/types/download'

// Downloads are Soulseek-only. Settings.downloadsEnabled is the single on/off switch; null falls
// back to DOWNLOADS_ENABLED (default true unless explicitly "false"), matching MONITOR_ENABLED's
// env-default-then-DB-override pattern (server/utils/monitorSettings.ts).
export const isDownloadsEnabled = async (): Promise<boolean> => {
  const envEnabled = process.env.DOWNLOADS_ENABLED !== 'false'
  const settings = await getSettingsRow().catch(() => null)
  return settings?.downloadsEnabled ?? envEnabled
}

// MISSING album/EP releases of monitored artists that MusicBrainz gave no release date for. pickFresh
// (autoDownload.ts) requires `year IS NOT NULL` to lay a release out as `YYYY - title`, so these are
// silently skipped forever — surfaced here so they're at least visible instead of invisible.
// See docs/downloader_issues.md #15.
export const listNoYearMissing = async (): Promise<NoYearMissingRelease[]> => {
  const rows = await prisma.$queryRaw<NoYearMissingRelease[]>(Prisma.sql`
    SELECT string_agg(DISTINCT a.name, ', ' ORDER BY a.name) AS artist, mr.title AS title
    FROM "MusicBrainzRelease" mr
    JOIN "ReleaseType" rt ON rt.id = mr."typeId" AND rt.slug IN ('album', 'ep')
    JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mr.id
    JOIN "Artist" a ON a.id = mra."artistId" AND a.monitored = true AND a.name NOT LIKE '%;%'
    WHERE mr.status = 'MISSING' AND mr.year IS NULL
    GROUP BY mr.id, mr.title
    ORDER BY artist, mr.title
  `)
  return rows
}

// The query above joins MusicBrainzRelease (350k rows, 68% MISSING) to its artists and their monitored flag - far too
// heavy to run on every /downloads queue poll, and it only changes when a sync runs. Cached in-process for 5 minutes.
const NO_YEAR_TTL_MS = 5 * 60_000
let noYearCache: { value: NoYearMissingRelease[], at: number } | null = null

export const cachedNoYearMissing = async (now: number = Date.now()): Promise<NoYearMissingRelease[]> => {
  if (noYearCache && now - noYearCache.at < NO_YEAR_TTL_MS) {
    return noYearCache.value
  }
  const value = await listNoYearMissing().catch(() => noYearCache?.value ?? [])
  noYearCache = { value, at: now }
  return value
}

export const _resetNoYearCacheForTest = (): void => {
  noYearCache = null
}

// Snapshot of why acquisition is (or isn't) running, for the /downloads idle banner.
export const getAcquisitionStatus = async (): Promise<Acquisition> => {
  const enabled = await isDownloadsEnabled()
  const noYearMissingReleases = await cachedNoYearMissing()
  const environment = await checkDownloadEnvironment()
  const canAcquire = enabled && acquireBlockReasons(environment).length === 0
  return { canAcquire, enabled, noYearMissing: noYearMissingReleases.length, noYearMissingReleases, environment }
}
