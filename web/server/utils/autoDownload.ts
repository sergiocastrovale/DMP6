import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { findBestSlskdResult, acquireRelease } from '~/server/utils/acquire'

// Mark a no-result/search-error attempt: bump attempts, abandon at the cap.
async function failNoResult(rowId: string, attempts: number, maxAttempts: number, error: string) {
  const next = attempts + 1
  await prisma.downloadedRelease.update({
    where: { id: rowId },
    data: { attempts: next, status: next >= maxAttempts ? 'ABANDONED' : 'FAILED', error },
  }).catch(() => {})
}

export interface ScanMissingResult {
  scanned: number
  queued: number
  skipped: number
  noResult: number
  queuedTitles: string[]
}

/**
 * Find releases that are in the MusicBrainz catalogue but missing locally and queue Soulseek
 * downloads for them (each lands in the approval queue as a DownloadedRelease). Capped per run.
 */
export async function scanMissingAndDownload(
  opts: { limit?: number; artistId?: string; monitoredOnly?: boolean } = {},
): Promise<ScanMissingResult> {
  const settings = await resolveDownloadSettings()
  if (!settings.downloadsPath) {
    throw createError({ statusCode: 503, message: 'DOWNLOADS_PATH not configured' })
  }
  const mon = await resolveMonitorSettings()
  const limit = opts.limit ?? mon.monitorCap
  const maxAttempts = Math.max(1, mon.maxDownloadAttempts)

  const artistFilter = {
    ...(opts.artistId ? { artistId: opts.artistId } : {}),
    ...(opts.monitoredOnly ? { artist: { monitored: true } } : {}),
  }
  const missing = await prisma.musicBrainzRelease.findMany({
    where: {
      status: 'MISSING',
      type: { slug: { in: ['album', 'ep'] } },
      ...(Object.keys(artistFilter).length ? { artists: { some: artistFilter } } : {}),
    },
    include: { artists: { include: { artist: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const result: ScanMissingResult = {
    scanned: missing.length, queued: 0, skipped: 0, noResult: 0, queuedTitles: [],
  }

  for (const mb of missing) {
    if (result.queued >= limit) break

    // Skip anything already being handled, or permanently given up on (ABANDONED).
    const existing = await prisma.downloadedRelease.findFirst({
      where: { mbReleaseId: mb.id, status: { in: ['DOWNLOADING', 'PENDING', 'APPROVED', 'PROMOTED', 'ABANDONED'] } },
      select: { id: true },
    })
    if (existing) { result.skipped++; continue }

    const artist = mb.artists[0]?.artist
    if (!artist) { result.skipped++; continue }

    // Retry backoff: don't re-attempt a recently-failed release (avoids hammering Soulseek
    // for releases it simply doesn't have). Reuse the row only after the cooldown.
    const cooldownAgo = new Date(Date.now() - mon.monitorRetryHours * 3_600_000)
    const prevFailed = await prisma.downloadedRelease.findFirst({
      where: { mbReleaseId: mb.id, status: 'FAILED' },
      select: { id: true, updatedAt: true, attempts: true },
    })
    if (prevFailed && prevFailed.updatedAt > cooldownAgo) { result.skipped++; continue }
    const carriedAttempts = prevFailed?.attempts ?? 0
    const pendingData = {
      artistId: artist.id,
      mbReleaseId: mb.id,
      releaseGroupId: mb.releaseGroupId ?? null,
      title: mb.title,
      year: mb.year ?? null,
      source: 'SLSKD' as const,
      status: 'DOWNLOADING' as const,
      error: null,
      slskUsername: null,
      quality: null,
      bytesTransferred: BigInt(0),
      lastProgressAt: new Date(),
    }
    const row = prevFailed
      ? await prisma.downloadedRelease.update({ where: { id: prevFailed.id }, data: pendingData })
      : await prisma.downloadedRelease.create({ data: pendingData })

    const query = `${artist.name} ${mb.title}`.trim()
    let best = null
    try {
      best = await findBestSlskdResult(
        query,
        settings.downloadFormats || undefined,
        settings.downloadMinBitrate ?? undefined,
      )
    }
    catch (e: any) {
      await failNoResult(row.id, carriedAttempts, maxAttempts, String(e?.message || e).slice(0, 500))
      result.noResult++
      continue
    }
    if (!best) {
      await failNoResult(row.id, carriedAttempts, maxAttempts, 'no Soulseek result found')
      result.noResult++
      continue
    }

    await acquireRelease({
      result: best,
      artistId: artist.id,
      artistName: artist.name,
      albumTitle: mb.title,
      year: mb.year ?? null,
      mbReleaseId: mb.id,
      releaseGroupId: mb.releaseGroupId ?? null,
    }, row.id)
    result.queued++
    result.queuedTitles.push(`${artist.name} - ${mb.title}`)
  }

  return result
}
