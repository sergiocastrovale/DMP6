import { statfs } from 'node:fs/promises'
import { Prisma } from '@prisma/client'
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

/**
 * Force an immediate re-download of a FAILED/ABANDONED release, bypassing the retry cooldown and the
 * per-cycle cap entirely. Flips the row to DOWNLOADING synchronously (so it leaves the Failed tab at
 * once), then runs a fresh Soulseek search + acquire detached. `files: []` parks it in the reconcile
 * loop's "not yet enqueued" grace window so it can't be failed before the search completes.
 */
export async function forceRetryDownload(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id }, include: { artist: true } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })
  if (!row.artist?.name) throw createError({ statusCode: 409, message: 'download has no artist' })

  await prisma.downloadedRelease.update({
    where: { id },
    data: { status: 'DOWNLOADING', attempts: 0, error: null, bytesTransferred: BigInt(0), lastProgressAt: new Date(), slskUsername: null, files: [] },
  })

  const artistName = row.artist.name
  ;(async () => {
    const settings = await resolveDownloadSettings()
    const best = await findBestSlskdResult(
      `${artistName} ${row.title}`.trim(),
      settings.downloadFormats || undefined,
      settings.downloadMinBitrate ?? undefined,
    ).catch(() => null)
    if (!best) {
      await prisma.downloadedRelease.update({
        where: { id },
        data: { status: 'FAILED', attempts: 1, error: 'no Soulseek result found (force retry)' },
      }).catch(() => {})
      return
    }
    await acquireRelease({
      result: best,
      artistId: row.artistId,
      artistName,
      albumTitle: row.title,
      year: row.year,
      mbReleaseId: row.mbReleaseId,
      releaseGroupId: row.releaseGroupId,
    }, row.id)
  })().catch(e => console.error(`[retry] ${row.title}: ${e?.message || e}`))
}

interface MissingPick {
  id: string
  title: string
  year: number | null
  releaseGroupId: string | null
  artistId: string
  artistName: string
}

let lastTopUpAt = 0
let topUpRunning = false

/** GB free under a path; -1 if unavailable (don't block on stat errors). */
async function freeGb(path: string): Promise<number> {
  try {
    const s = await statfs(path)
    return (Number(s.bavail) * Number(s.bsize)) / 1e9
  }
  catch { return -1 }
}

// Artist-first random pick: choose random monitored, non-junk artists (indexed) and take one eligible
// MISSING album/EP each. Avoids a full random sort over the entire MISSING pool every tick at 19K.
async function pickCandidates(slots: number, cooldown: Date): Promise<MissingPick[]> {
  const artists = await prisma.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`
    SELECT a.id, a.name FROM "Artist" a
    WHERE a.monitored = true AND a."relatedOnly" = false AND a.name NOT LIKE '%;%'
    ORDER BY random() LIMIT ${slots * 4}
  `)
  const picks: MissingPick[] = []
  for (const a of artists) {
    if (picks.length >= slots) break
    const rel = await prisma.$queryRaw<MissingPick[]>(Prisma.sql`
      SELECT mr.id, mr.title, mr.year, mr."releaseGroupId",
             ${a.id} AS "artistId", ${a.name} AS "artistName"
      FROM "MusicBrainzRelease" mr
      JOIN "ReleaseType" rt ON rt.id = mr."typeId" AND rt.slug IN ('album', 'ep')
      JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mr.id AND mra."artistId" = ${a.id}
      WHERE mr.status = 'MISSING'
        AND NOT EXISTS (
          SELECT 1 FROM "DownloadedRelease" dr
          WHERE dr."mbReleaseId" = mr.id
            AND (dr.status IN ('DOWNLOADING', 'ENRICHING', 'PENDING', 'APPROVED', 'PROMOTED', 'ABANDONED')
                 OR (dr.status = 'FAILED' AND dr."updatedAt" > ${cooldown}))
        )
      ORDER BY random() LIMIT 1
    `)
    if (rel[0]) picks.push(rel[0])
  }
  return picks
}

/**
 * Trickle worker (Search-Sniper style) for always-on, 19K-scale acquisition. Keeps at most
 * `maxConcurrentDownloads` active slskd transfers; each run tops up by picking a few eligible MISSING
 * album/EP releases of random monitored artists, skipping handled / recently-failed. Creates each row
 * DOWNLOADING before searching so the next tick excludes it. Run-guarded + throttled + disk-gated.
 */
export async function topUpDownloads(): Promise<void> {
  if (topUpRunning) return
  const settings = await resolveDownloadSettings()
  if (!settings.downloadsPath) return
  const mon = await resolveMonitorSettings()

  if (Date.now() - lastTopUpAt < Math.max(5, mon.searchIntervalSec) * 1000) return

  // Disk guard: stop grabbing if the downloads volume is nearly full.
  const free = await freeGb(settings.downloadsPath)
  if (free >= 0 && free < mon.downloadsMinFreeGb) {
    if (Date.now() - lastTopUpAt > 600_000) console.log(`[monitor] topUp paused: only ${free.toFixed(1)}GB free`)
    lastTopUpAt = Date.now()
    return
  }

  topUpRunning = true
  lastTopUpAt = Date.now()
  try {
    const maxConc = Math.max(1, mon.maxConcurrentDownloads)
    const inFlight = await prisma.downloadedRelease.count({ where: { status: 'DOWNLOADING' } })
    const slots = Math.min(maxConc - inFlight, Math.max(1, mon.searchPicksPerInterval))
    if (slots <= 0) return

    const cooldown = new Date(Date.now() - mon.monitorRetryHours * 3_600_000)
    const picks = await pickCandidates(slots, cooldown)
    if (picks.length === 0) return

    const maxAttempts = Math.max(1, mon.maxDownloadAttempts)
  for (const p of picks) {
    // Reuse a past-cooldown FAILED row if present (carry its attempt count), else create fresh.
    const prior = await prisma.downloadedRelease.findFirst({
      where: { mbReleaseId: p.id, status: 'FAILED' },
      select: { id: true, attempts: true },
    })
    const data = {
      artistId: p.artistId,
      mbReleaseId: p.id,
      releaseGroupId: p.releaseGroupId,
      title: p.title,
      year: p.year,
      source: 'SLSKD' as const,
      status: 'DOWNLOADING' as const,
      error: null,
      slskUsername: null,
      quality: null,
      files: [] as Prisma.InputJsonValue,
      bytesTransferred: BigInt(0),
      lastProgressAt: new Date(),
    }
    const row = prior
      ? await prisma.downloadedRelease.update({ where: { id: prior.id }, data })
      : await prisma.downloadedRelease.create({ data })

    const best = await findBestSlskdResult(
      `${p.artistName} ${p.title}`.trim(),
      settings.downloadFormats || undefined,
      settings.downloadMinBitrate ?? undefined,
    ).catch(() => null)
    if (!best) {
      await failNoResult(row.id, prior?.attempts ?? 0, maxAttempts, 'no Soulseek result found')
      continue
    }
      await acquireRelease({
        result: best,
        artistId: p.artistId,
        artistName: p.artistName,
        albumTitle: p.title,
        year: p.year,
        mbReleaseId: p.id,
        releaseGroupId: p.releaseGroupId,
      }, row.id)
    }
  }
  finally {
    topUpRunning = false
  }
}
