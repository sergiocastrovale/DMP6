import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { checkDownloadEnvironment, acquireBlockReasons } from '~/server/utils/downloadEnvironment'
import type { Acquisition } from '~/types/download'

// Downloads are Soulseek-only. Settings.downloadsEnabled is the single on/off switch; null falls
// back to DOWNLOADS_ENABLED (default true unless explicitly "false"), matching MONITOR_ENABLED's
// env-default-then-DB-override pattern (server/utils/monitorSettings.ts).
export async function isDownloadsEnabled(): Promise<boolean> {
  const envEnabled = process.env.DOWNLOADS_ENABLED !== 'false'
  const settings = await prisma.settings.findUnique({ where: { id: 'main' }, select: { downloadsEnabled: true } }).catch(() => null)
  return settings?.downloadsEnabled ?? envEnabled
}

// MISSING album/EP releases of monitored artists that MusicBrainz gave no release date for. pickFresh
// (autoDownload.ts) requires `year IS NOT NULL` to lay a release out as `YYYY - title`, so these are
// silently skipped forever — surfaced here so they're at least visible instead of invisible.
// See docs/downloader_issues.md #15.
export async function countNoYearMissing(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT count(DISTINCT mr.id)::bigint AS count
    FROM "MusicBrainzRelease" mr
    JOIN "ReleaseType" rt ON rt.id = mr."typeId" AND rt.slug IN ('album', 'ep')
    JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mr.id
    JOIN "Artist" a ON a.id = mra."artistId" AND a.monitored = true AND a.name NOT LIKE '%;%'
    WHERE mr.status = 'MISSING' AND mr.year IS NULL
  `)
  return Number(rows[0]?.count ?? 0)
}

// The count above joins MusicBrainzRelease (350k rows, 68% MISSING) to its artists and their monitored flag - far too
// heavy to run on every /downloads queue poll, and it only changes when a sync runs. Cached in-process for 5 minutes.
const NO_YEAR_TTL_MS = 5 * 60_000
let noYearCache: { value: number, at: number } | null = null

export async function cachedNoYearMissing(now: number = Date.now()): Promise<number> {
  if (noYearCache && now - noYearCache.at < NO_YEAR_TTL_MS) {
    return noYearCache.value
  }
  const value = await countNoYearMissing().catch(() => noYearCache?.value ?? 0)
  noYearCache = { value, at: now }
  return value
}

export const _resetNoYearCacheForTest = (): void => {
  noYearCache = null
}

// Snapshot of why acquisition is (or isn't) running, for the /downloads idle banner.
export async function getAcquisitionStatus(): Promise<Acquisition> {
  const enabled = await isDownloadsEnabled()
  const noYearMissing = await cachedNoYearMissing()
  const environment = await checkDownloadEnvironment()
  const canAcquire = enabled && acquireBlockReasons(environment).length === 0
  return { canAcquire, enabled, noYearMissing, environment }
}
