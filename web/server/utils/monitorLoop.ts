import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, rm, access } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { prisma } from '~/server/utils/prisma'
import { scanMissingAndDownload } from '~/server/utils/autoDownload'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { resolveSongkongEnabled, songkongDirs, songkongMaxWaitMin } from '~/server/utils/songkongSettings'
import { transformToLibraryLayout } from '~/server/utils/layout'
import {
  getSlskdActiveDownloads,
  isSlskdTerminal,
  cancelSlskdDownload,
  relocateDownloadedFiles,
} from '~/server/utils/slskd'

const execFileAsync = promisify(execFile)

const log = (msg: string) => console.log(`[monitor] ${msg}`)

let downloadCycleRunning = false
let gapsCycleRunning = false
let reconcileRunning = false
const finalizing = new Set<string>()

const baseName = (f: string) => basename(f.replace(/\\/g, '/'))

/**
 * Drive DOWNLOADING rows to their terminal state by checking slskd's actual transfer state —
 * the single owner of finalization. Idempotent, survives restarts, self-heals stuck rows.
 *  - transfers finished (or already gone) -> move + transcode -> PENDING (or FAILED if nothing landed)
 *  - transfers still active but older than the hard timeout -> cancel + FAILED
 * Runs frequently (server plugin) so a refresh/poll always reflects reality.
 */
export async function reconcileDownloads(): Promise<void> {
  if (reconcileRunning) return
  reconcileRunning = true
  let failed = 0
  let finalized = 0
  try {
    const rows = await prisma.downloadedRelease.findMany({
      where: { status: { in: ['DOWNLOADING', 'ENRICHING'] } },
      include: { artist: { select: { name: true } } },
    })
    if (rows.length === 0) return

    const settings = await resolveDownloadSettings()
    if (!settings.downloadsPath) return
    const enrichRows = rows.filter(r => r.status === 'ENRICHING')
    const downloadingRows = rows.filter(r => r.status === 'DOWNLOADING')
    if (enrichRows.length > 0) {
      finalized += await drainEnriching(enrichRows, settings.downloadsPath)
    }
    if (downloadingRows.length === 0) {
      if (failed || finalized) log(`reconcile done: ${finalized} -> PENDING, ${failed} -> FAILED/ABANDONED`)
      return
    }
    const mon = await resolveMonitorSettings()
    const transfers = await withTimeout(getSlskdActiveDownloads(), 15_000).catch(() => [])

    const ORPHAN_MIN = 3                              // file-less row stuck this long = restart orphan
    const noProgressMs = Math.max(15, mon.noProgressSec) * 1000
    const maxAttempts = Math.max(1, mon.maxDownloadAttempts)
    log(`reconcile: ${downloadingRows.length} downloading, ${transfers.length} slskd transfers`)

    for (const row of downloadingRows) {
      if (finalizing.has(row.id)) continue
      const files = (row.files as Array<{ filename: string; size: number }> | null) ?? []
      const ageMin = (Date.now() - row.updatedAt.getTime()) / 60000

      // Row created but not yet enqueued (autoDownload creates the row, then runs a slow
      // Soulseek search before files exist). Restart-orphan if it lingers.
      if (files.length === 0) {
        if (ageMin > ORPHAN_MIN) { await failAttempt(row, maxAttempts, 'never enqueued (no files)'); failed++ }
        continue
      }

      const expected = new Set(files.map(f => baseName(String(f.filename))))
      const ours = transfers.filter(t => t.username === row.slskUsername && expected.has(baseName(t.filename)))
      const active = ours.some(t => !isSlskdTerminal(t.state))

      // Goal 1: a download that isn't moving must die. Track the byte watermark.
      if (active) {
        const bytes = ours.reduce((s, t) => s + (t.bytesTransferred || 0), 0)
        const prevBytes = Number(row.bytesTransferred || 0)
        const lastProgress = (row.lastProgressAt ?? row.updatedAt).getTime()
        if (bytes > prevBytes) {
          await prisma.downloadedRelease.update({
            where: { id: row.id },
            data: { bytesTransferred: BigInt(bytes), lastProgressAt: new Date() },
          }).catch(() => {})
        }
        else if (Date.now() - lastProgress > noProgressMs) {
          for (const t of ours) await cancelSlskdDownload(row.slskUsername!, t.id).catch(() => {})
          await failAttempt(row, maxAttempts, `no progress for ${mon.noProgressSec}s`)
          failed++
          log(`reconcile: ${row.title} stalled -> ${row.attempts + 1 >= maxAttempts ? 'ABANDONED' : 'FAILED'}`)
        }
        continue
      }

      // No active transfer: finished (terminal) or slskd dropped it. Finalize.
      finalizing.add(row.id)
      try {
        if (!row.artist?.name) { await failAttempt(row, maxAttempts, 'missing artist'); failed++; continue }
        // Bounded so one slow transfer/transcode can't wedge the whole reconcile loop.
        const res = await withTimeout(relocateDownloadedFiles({
          username: row.slskUsername!,
          files: files.map(f => String(f.filename)),
          downloadsPath: settings.downloadsPath,
          dirTemplate: settings.downloadDirTemplate,
          artistName: row.artist.name,
          albumTitle: row.title,
          year: row.year ?? null,
        }), 5 * 60_000)
        if (res.movedCount > 0) {
          if (await resolveSongkongEnabled()) {
            // Hand off to SongKong (host cron drainer) for enrichment before the layout transform.
            const dirs = songkongDirs(settings.downloadsPath)
            await mkdir(dirs.spool, { recursive: true })
            await writeFile(join(dirs.spool, row.id), `${res.targetDir}\n`)
            await prisma.downloadedRelease.update({
              where: { id: row.id },
              data: { status: 'ENRICHING', stagingPath: res.targetDir, error: null },
            })
            log(`reconcile: ${row.title} -> ENRICHING (spooled ${res.movedCount} files)`)
          }
          else {
            const releaseRoot = await transformToLibraryLayout(row.id, res.targetDir)
            await prisma.downloadedRelease.update({
              where: { id: row.id },
              data: { status: 'PENDING', stagingPath: releaseRoot, error: null },
            })
            finalized++
            log(`reconcile: ${row.title} -> PENDING (${res.movedCount} files)`)
          }
        }
        else {
          await failAttempt(row, maxAttempts, 'no files landed in the staging folder', res.targetDir)
          failed++
        }
      }
      catch (e: any) {
        await failAttempt(row, maxAttempts, String(e?.message || e).slice(0, 500))
        failed++
      }
      finally {
        finalizing.delete(row.id)
      }
    }
    if (failed || finalized) log(`reconcile done: ${finalized} -> PENDING, ${failed} -> FAILED/ABANDONED`)
  }
  catch (e: any) {
    log(`reconcile failed: ${e?.message || e}`)
  }
  finally {
    reconcileRunning = false
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ])
}

// Increment the attempt counter; after maxAttempts give up permanently (ABANDONED).
async function failAttempt(
  row: { id: string; attempts: number },
  maxAttempts: number,
  error: string,
  stagingPath?: string,
) {
  const attempts = (row.attempts ?? 0) + 1
  await prisma.downloadedRelease.update({
    where: { id: row.id },
    data: {
      attempts,
      status: attempts >= maxAttempts ? 'ABANDONED' : 'FAILED',
      error,
      ...(stagingPath ? { stagingPath } : {}),
    },
  }).catch(() => {})
}

/**
 * Drive ENRICHING rows to PENDING. A row stays ENRICHING until the host SongKong drainer writes a
 * `done/<id>` marker, then we run the library-layout transform. If the marker never appears within
 * the max-wait window (drainer down / SongKong stuck), we promote unenriched rather than strand the
 * download. File-based + idempotent, so it survives restarts. Returns rows finalized to PENDING.
 */
async function drainEnriching(
  rows: Array<{ id: string; title: string; stagingPath: string | null; updatedAt: Date }>,
  downloadsPath: string,
): Promise<number> {
  const dirs = songkongDirs(downloadsPath)
  const maxWaitMs = songkongMaxWaitMin() * 60_000
  let done = 0
  for (const row of rows) {
    if (finalizing.has(row.id)) continue
    if (!row.stagingPath) continue
    const enriched = await access(join(dirs.done, row.id)).then(() => true, () => false)
    const timedOut = Date.now() - row.updatedAt.getTime() > maxWaitMs
    if (!enriched && !timedOut) continue

    finalizing.add(row.id)
    try {
      const releaseRoot = await withTimeout(transformToLibraryLayout(row.id, row.stagingPath), 5 * 60_000)
      await prisma.downloadedRelease.update({
        where: { id: row.id },
        data: {
          status: 'PENDING',
          stagingPath: releaseRoot,
          error: enriched ? null : 'SongKong enrichment timed out; promoted without enrichment',
        },
      })
      await rm(join(dirs.spool, row.id), { force: true }).catch(() => {})
      await rm(join(dirs.done, row.id), { force: true }).catch(() => {})
      done++
      log(`reconcile: ${row.title} -> PENDING (${enriched ? 'enriched' : 'enrich timed out'})`)
    }
    catch (e: any) {
      log(`reconcile: ${row.title} layout transform failed: ${String(e?.message || e).slice(0, 300)}`)
    }
    finally {
      finalizing.delete(row.id)
    }
  }
  return done
}

/**
 * Fast loop: attempt Soulseek downloads for MISSING releases of monitored artists.
 * Each acquisition lands in the approval queue (DownloadedRelease).
 */
export async function runMonitorCycle(cap: number): Promise<void> {
  if (downloadCycleRunning) { log('download cycle still running, skip'); return }
  downloadCycleRunning = true
  try {
    const monitored = await prisma.artist.count({ where: { monitored: true } })
    if (monitored === 0) { log('download cycle: no monitored artists'); return }
    const res = await scanMissingAndDownload({ limit: cap, monitoredOnly: true })
    log(`download cycle: ${monitored} monitored artists | scanned ${res.scanned} missing | queued ${res.queued} | skipped ${res.skipped} | no result ${res.noResult}`)
  }
  catch (e: any) {
    log(`download cycle failed: ${e?.message || e}`)
  }
  finally {
    downloadCycleRunning = false
  }
}

/**
 * Slow loop: refresh the MusicBrainz catalogue of every monitored artist so newly released
 * albums show up as MISSING (then the fast loop picks them up). 1 MB API call per artist.
 */
export async function runGapsCycle(): Promise<void> {
  if (gapsCycleRunning) { log('gaps cycle still running, skip'); return }
  gapsCycleRunning = true
  try {
    const artists = await prisma.artist.findMany({
      where: { monitored: true, musicbrainzId: { not: null } },
      select: { name: true },
      orderBy: { name: 'asc' },
    })
    if (artists.length === 0) return
    log(`gaps cycle: refreshing catalogue for ${artists.length} monitored artist(s)`)

    const root = process.env.PROJECT_ROOT || process.cwd()
    const scriptsDir = process.env.SCRIPTS_DIR || root
    const binary = join(scriptsDir, 'sync')

    for (const a of artists) {
      try {
        await execFileAsync(binary, ['--catalogue-gaps', '--only', a.name, '--exact'], {
          cwd: root,
          maxBuffer: 1024 * 1024 * 32,
        })
      }
      catch (e: any) {
        log(`gaps cycle: ${a.name} failed: ${String(e?.message || e).split('\n')[0]}`)
      }
    }
    log('gaps cycle done')
  }
  catch (e: any) {
    log(`gaps cycle failed: ${e?.message || e}`)
  }
  finally {
    gapsCycleRunning = false
  }
}
