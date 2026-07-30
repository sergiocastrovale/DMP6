import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { findBestSlskdResult, acquireRelease } from '~/server/utils/acquire'
import { acquireTorrentRelease } from '~/server/utils/acquireTorrent'
import { getDownloadSources, chooseSource, RT_PRIORITY, SLSK_PRIORITY, rtBudgetAvailable, consumeRtBudget, exhaustRtBudget } from '~/server/utils/downloadSources'
import { prowlarrRtLimited } from '~/server/utils/prowlarr'
import { isDownloadsPaused } from '~/server/utils/pauseState'
import { monitorLog } from '~/server/utils/monitorLog'

// Mark a search-miss: slskd had no result. NOT a failure — never abandons. Bumps the tries counter
// (shown in the UI) and lowers priority (floor 0) so the release sinks behind fresher candidates and
// is retried later. Status -> UNAVAILABLE (its own queue tab, distinct from real download failures).
async function failNoResult(rowId: string, attempts: number, priority: number, error: string) {
  await prisma.downloadedRelease.update({
    where: { id: rowId },
    data: { attempts: attempts + 1, priority: Math.max(0, priority - 1), status: 'UNAVAILABLE', error },
  }).catch(() => {})
}

// Mark a RuTracker miss: no torrent contained the release. RT has retry=false, so we record it in
// triedSources (never search RT for this release again) and drop the release into the Soulseek priority
// band so the next pick falls through to slsk. Status UNAVAILABLE keeps it in the retry pool.
export async function failRtMiss(rowId: string, attempts: number, error: string) {
  await prisma.downloadedRelease.update({
    where: { id: rowId },
    data: {
      attempts: attempts + 1,
      priority: SLSK_PRIORITY,
      status: 'UNAVAILABLE',
      triedSources: { push: 'RUTRACKER' },
      error,
    },
  }).catch(() => {})
}

// The RuTracker search was REFUSED by Prowlarr's daily-cap, not a real no-match: revert the row to a
// retryable state WITHOUT recording RuTracker in triedSources (so it's searched on RT again once the
// cap resets) and WITHOUT bumping attempts. Keep it in the RT priority band. The caller has already
// flagged the budget spent, so it falls through to Soulseek meanwhile if that source is enabled.
async function revertRtLimited(rowId: string) {
  await prisma.downloadedRelease.update({
    where: { id: rowId },
    data: { priority: RT_PRIORITY, status: 'UNAVAILABLE', error: 'RuTracker daily query limit reached' },
  }).catch(() => {})
}

export interface AcquireParamsLite {
  artistId: string
  artistName: string
  albumTitle: string
  year: number | null
  mbReleaseId: string | null
  releaseGroupId: string | null
}

// Run the source-appropriate acquire for an already-created DOWNLOADING row. Returns true on a hit
// (transfer/torrent enqueued), false on a search miss (caller records the miss per source).
export async function routeAcquire(
  src: 'RUTRACKER' | 'SLSKD',
  p: AcquireParamsLite,
  rowId: string,
  formats: string,
  minBitrate: number | null,
): Promise<boolean> {
  if (src === 'RUTRACKER') {
    // One Prowlarr /search per call — spend a unit of the daily RuTracker budget up-front.
    await consumeRtBudget()
    const res = await acquireTorrentRelease(p, rowId).catch(() => null)
    return !!res
  }
  const best = await findBestSlskdResult(
    `${p.artistName} ${p.albumTitle}`.trim(), formats || undefined, minBitrate ?? undefined,
  ).catch(() => null)
  if (!best) return false
  await acquireRelease({
    result: best,
    artistId: p.artistId,
    artistName: p.artistName,
    albumTitle: p.albumTitle,
    year: p.year,
    mbReleaseId: p.mbReleaseId,
    releaseGroupId: p.releaseGroupId,
  }, rowId)
  return true
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
  if (!row.artistId) throw createError({ statusCode: 409, message: 'download has no artist' })

  // Route by source, honouring triedSources (a no-retry RuTracker miss is never re-tried even on a
  // force retry). Resets priority to 10 but keeps triedSources, so RT stays excluded once exhausted.
  const configs = await getDownloadSources()
  const src = chooseSource(10, row.triedSources, configs, await rtBudgetAvailable())

  await prisma.downloadedRelease.update({
    where: { id },
    data: { status: 'DOWNLOADING', attempts: 0, priority: 10, error: null, bytesTransferred: BigInt(0), lastProgressAt: new Date(), slskUsername: null, torrentHash: null, torrentFolder: null, files: [], ...(src ? { source: src } : {}) },
  })

  if (!src) {
    await prisma.downloadedRelease.update({
      where: { id }, data: { status: 'UNAVAILABLE', error: 'no download source enabled' },
    }).catch(() => {})
    return
  }

  const artistName = row.artist.name
  const artistId = row.artistId
  ;(async () => {
    const settings = await resolveDownloadSettings()
    const params = {
      artistId, artistName, albumTitle: row.title,
      year: row.year, mbReleaseId: row.mbReleaseId, releaseGroupId: row.releaseGroupId,
    }
    const hit = await routeAcquire(src, params, row.id, settings.downloadFormats, settings.downloadMinBitrate)
    if (!hit) {
      src === 'RUTRACKER'
        ? await failRtMiss(row.id, row.attempts, 'no RuTracker match (search miss)')
        : await prisma.downloadedRelease.update({
            where: { id },
            data: { status: 'UNAVAILABLE', attempts: 1, priority: 9, error: 'no Soulseek result (search miss)' },
          }).catch(() => {})
    }
  })().catch(e => monitorLog('error', `force-retry ${row.title}: ${e?.message || e}`))
}

interface MissingPick {
  id: string
  title: string
  year: number | null
  releaseGroupId: string | null
  artistId: string
  artistName: string
  rowId: string | null     // existing DownloadedRelease row (retry pool); null = fresh, create one
  attempts: number         // carried from the existing row (0 for fresh)
  priority: number         // carried from the existing row (10 for fresh)
  triedSources: ('SLSKD' | 'RUTRACKER')[] // no-retry sources already missed (carried; [] for fresh)
}

let lastTopUpAt = 0
let topUpRunning = false

// Fresh pool: random monitored, non-junk artists (indexed), one never-tried MISSING album/EP each
// (no DownloadedRelease row exists yet -> implicit priority 10). Avoids a full random sort over the
// whole MISSING pool every tick at 19K.
async function pickFresh(slots: number): Promise<MissingPick[]> {
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
             ${a.id} AS "artistId", ${a.name} AS "artistName",
             NULL::text AS "rowId", 0 AS attempts, 10 AS priority,
             ARRAY[]::"DownloadSource"[] AS "triedSources"
      FROM "MusicBrainzRelease" mr
      JOIN "ReleaseType" rt ON rt.id = mr."typeId" AND rt.slug IN ('album', 'ep')
      JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mr.id AND mra."artistId" = ${a.id}
      WHERE mr.status = 'MISSING'
        AND mr.year IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "DownloadedRelease" dr
          WHERE (mr."releaseGroupId" IS NOT NULL AND dr."releaseGroupId" = mr."releaseGroupId")
             OR dr."mbReleaseId" = mr.id
        )
      ORDER BY random() LIMIT 1
    `)
    if (rel[0]) picks.push(rel[0])
  }
  return picks
}

// Retry pool: already-tried releases still MISSING — UNAVAILABLE (search miss) or FAILED (download
// died below the cap). Ordered by priority DESC so the least-failed retry first; random within tier.
// ABANDONED/REJECTED are terminal and excluded.
async function pickRetry(slots: number): Promise<MissingPick[]> {
  // Join on the stable releaseGroupId first (survives the MB release row being deleted + recreated
  // with a fresh cuid by sync/catalogue-gaps); fall back to the volatile mbReleaseId only for legacy
  // rows predating that column being populated. DISTINCT ON dr.id guards against a fan-out if more
  // than one MISSING placeholder somehow exists for the same group.
  return prisma.$queryRaw<MissingPick[]>(Prisma.sql`
    WITH matched AS (
      SELECT DISTINCT ON (dr.id)
             mr.id, mr.title, mr.year, mr."releaseGroupId",
             dr."artistId", dr.id AS "rowId", dr.attempts AS attempts, dr.priority AS priority,
             dr."triedSources" AS "triedSources"
      FROM "DownloadedRelease" dr
      JOIN "MusicBrainzRelease" mr ON (
        (dr."releaseGroupId" IS NOT NULL AND mr."releaseGroupId" = dr."releaseGroupId")
        OR (dr."releaseGroupId" IS NULL AND mr.id = dr."mbReleaseId")
      ) AND mr.status = 'MISSING' AND mr.year IS NOT NULL
      WHERE dr.status IN ('UNAVAILABLE', 'FAILED', 'INVALID')
      ORDER BY dr.id, mr."updatedAt" DESC
    )
    SELECT m.id, m.title, m.year, m."releaseGroupId",
           a.id AS "artistId", a.name AS "artistName",
           m."rowId", m.attempts, m.priority, m."triedSources"
    FROM matched m
    JOIN "Artist" a ON a.id = m."artistId" AND a.monitored = true AND a."relatedOnly" = false AND a.name NOT LIKE '%;%'
    ORDER BY m.priority DESC, random() LIMIT ${slots}
  `)
}

// Fill `slots` fresh-first (deprioritized retries yield to fresh candidates), but always reserve at
// least one slot for the retry pool when it has candidates so sunk items keep trickling. Each pool
// fills the other's shortfall. As MISSING is exhausted into rows, fresh thins and retries take over.
async function pickCandidates(slots: number): Promise<MissingPick[]> {
  const reservedRetry = Math.min(slots, 1)
  const fresh = await pickFresh(slots - reservedRetry)
  const remaining = slots - fresh.length
  const retry = remaining > 0 ? await pickRetry(remaining) : []
  return [...fresh, ...retry]
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
  if (await isDownloadsPaused()) return // global pause (manual or disk-full); see pauseState.ts

  topUpRunning = true
  lastTopUpAt = Date.now()
  try {
    const maxConc = Math.max(1, mon.maxConcurrentDownloads)
    const inFlight = await prisma.downloadedRelease.count({ where: { status: 'DOWNLOADING' } })
    const slots = Math.min(maxConc - inFlight, Math.max(1, mon.searchPicksPerInterval))
    if (slots <= 0) return

    const picks = await pickCandidates(slots)
    if (picks.length === 0) return

    const configs = await getDownloadSources()

  for (const p of picks) {
    // Route by source: RuTracker first (while it has daily budget), Soulseek fallback. Re-check the
    // budget per pick since each RT search spends a unit. Skip if nothing eligible.
    const rtOk = await rtBudgetAvailable()
    const src = chooseSource(p.priority, p.triedSources, configs, rtOk)
    if (!src) continue

    // Retry-pool picks carry their existing row (and attempts/priority); fresh picks create a new one.
    const data = {
      artistId: p.artistId,
      mbReleaseId: p.id,
      releaseGroupId: p.releaseGroupId,
      title: p.title,
      year: p.year,
      source: src,
      status: 'DOWNLOADING' as const,
      error: null,
      slskUsername: null,
      quality: null,
      files: [] as Prisma.InputJsonValue,
      bytesTransferred: BigInt(0),
      lastProgressAt: new Date(),
    }
    const row = p.rowId
      ? await prisma.downloadedRelease.update({ where: { id: p.rowId }, data })
      : await prisma.downloadedRelease.create({ data })

    const params = {
      artistId: p.artistId, artistName: p.artistName, albumTitle: p.title,
      year: p.year, mbReleaseId: p.id, releaseGroupId: p.releaseGroupId,
    }
    const hit = await routeAcquire(src, params, row.id, settings.downloadFormats, settings.downloadMinBitrate)
    if (!hit) {
      if (src === 'RUTRACKER' && await prowlarrRtLimited()) {
        // Refused by Prowlarr's shared 25/day cap, not a real miss: stop wasting RT searches today and
        // keep the release retryable on RT. Surfaces in the /downloads Recent issues panel.
        await exhaustRtBudget()
        await revertRtLimited(row.id)
        monitorLog('warn', 'RuTracker daily query limit reached (shared with Lidarr) — backing off until reset')
      }
      else if (src === 'RUTRACKER') {
        await failRtMiss(row.id, p.attempts, 'no RuTracker match (search miss)')
      }
      else {
        await failNoResult(row.id, p.attempts, p.priority, 'no Soulseek result (search miss)')
      }
    }
  }
  }
  finally {
    topUpRunning = false
  }
}
