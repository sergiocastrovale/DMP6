import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import type { Acquisition } from '~/types/download'

// Downloads are Soulseek-only. Settings.downloadsEnabled is the single on/off switch; null = enabled.
export async function isDownloadsEnabled(): Promise<boolean> {
  const settings = await prisma.settings.findUnique({ where: { id: 'main' }, select: { downloadsEnabled: true } }).catch(() => null)
  return settings?.downloadsEnabled ?? true
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

// Snapshot of why acquisition is (or isn't) running, for the /downloads idle banner.
export async function getAcquisitionStatus(): Promise<Acquisition> {
  const enabled = await isDownloadsEnabled()
  const noYearMissing = await countNoYearMissing().catch(() => 0)
  return { canAcquire: enabled, enabled, noYearMissing }
}
