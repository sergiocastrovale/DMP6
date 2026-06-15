import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, rm, access } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { resolveSongkongEnabled, songkongDirs, songkongMaxWaitMin } from '~/server/utils/songkongSettings'
import { transformToLibraryLayout } from '~/server/utils/layout'
import { approveDownloadedRelease, mergeManyDownloadedReleases } from '~/server/utils/promote'
import { runExclusive } from '~/server/utils/scriptLock'
import { isDownloadsPaused } from '~/server/utils/pauseState'
import { monitorLog } from '~/server/utils/monitorLog'
import {
  getSlskdActiveDownloads,
  isSlskdTerminal,
  cancelSlskdDownload,
  relocateDownloadedFiles,
  purgeDownloadedSourceFiles,
} from '~/server/utils/slskd'

const execFileAsync = promisify(execFile)

const log = (msg: string) => monitorLog('notice', msg)
const logWarn = (msg: string) => monitorLog('warn', msg)
const logErr = (msg: string) => monitorLog('error', msg)

let gapsCycleRunning = false
let lastGapsRunAt = 0
let autoMergeRunning = false
let lastAutoMergeAt = 0
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
      finalized += await drainEnriching(enrichRows)
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
      let stalled = false
      if (active) {
        const bytes = ours.reduce((s, t) => s + (t.bytesTransferred || 0), 0)
        const prevBytes = Number(row.bytesTransferred || 0)
        const lastProgress = (row.lastProgressAt ?? row.updatedAt).getTime()
        if (bytes > prevBytes) {
          await prisma.downloadedRelease.update({
            where: { id: row.id },
            data: { bytesTransferred: BigInt(bytes), lastProgressAt: new Date() },
          }).catch(() => {})
          continue
        }
        if (Date.now() - lastProgress <= noProgressMs) { continue } // still within the no-progress grace window
        // Stalled: cancel the stuck transfers, then fall through to finalize so any siblings that DID
        // complete are still captured into the library before we give up on the rest.
        for (const t of ours) await cancelSlskdDownload(row.slskUsername!, t.id).catch(() => {})
        stalled = true
      }

      // Reached here: every transfer is terminal (finished/dropped) or we just cancelled a stall.
      // Finalize — relocate whatever landed; only give up if nothing usable is on disk.
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
            const dirs = songkongDirs()
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
            await settleFinished(row.id, releaseRoot, null)
            finalized++
            log(`reconcile: ${row.title} -> ready (${res.movedCount} files)`)
          }
        }
        else {
          const reason = stalled ? `no progress for ${mon.noProgressSec}s` : 'no files landed in the staging folder'
          await failAttempt(row, maxAttempts, reason, res.targetDir)
          // Nothing usable landed — purge whatever stray/partial source files exist for this download.
          await purgeDownloadedSourceFiles(settings.downloadsPath, files.map(f => String(f.filename))).catch(() => {})
          failed++
        }
      }
      catch (e: any) {
        await failAttempt(row, maxAttempts, String(e?.message || e).slice(0, 500))
        await purgeDownloadedSourceFiles(settings.downloadsPath, files.map(f => String(f.filename))).catch(() => {})
        failed++
      }
      finally {
        finalizing.delete(row.id)
      }
    }
    if (failed || finalized) log(`reconcile done: ${finalized} -> PENDING, ${failed} -> FAILED/ABANDONED`)
  }
  catch (e: any) {
    logErr(`reconcile failed: ${e?.message || e}`)
  }
  finally {
    reconcileRunning = false
  }
}

// Mark a finished download PENDING (ready for approval); if auto-approve is on, immediately move it
// to the approved folder (APPROVED, "Ready to merge") so the pipeline is hands-off to the merge gate.
async function settleFinished(id: string, stagingPath: string, error: string | null): Promise<void> {
  await prisma.downloadedRelease.update({ where: { id }, data: { status: 'PENDING', stagingPath, error } })
  const { autoApproveDownloads } = await resolveDownloadSettings()
  if (autoApproveDownloads) {
    await approveDownloadedRelease(id).catch(e => logErr(`auto-approve failed for ${id}: ${e?.message || e}`))
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
): Promise<number> {
  const dirs = songkongDirs()
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
      await settleFinished(row.id, releaseRoot, enriched ? null : 'SongKong enrichment timed out; merged without enrichment')
      await rm(join(dirs.spool, row.id), { force: true }).catch(() => {})
      await rm(join(dirs.done, row.id), { force: true }).catch(() => {})
      done++
      log(`reconcile: ${row.title} -> ready (${enriched ? 'enriched' : 'enrich timed out'})`)
    }
    catch (e: any) {
      logErr(`reconcile: ${row.title} layout transform failed: ${String(e?.message || e).slice(0, 300)}`)
    }
    finally {
      finalizing.delete(row.id)
    }
  }
  return done
}

/**
 * Catalogue-gap trickle: refresh a small round-robin batch of monitored artists' MusicBrainz
 * catalogue each run (oldest lastGapsCheckedAt first) so new releases surface as MISSING — which the
 * download worker then grabs. One `sync --catalogue-gaps --only "A;B;..." --exact` spawn per batch
 * (--only is semicolon-separated). Self-throttled (gapsIntervalMin) + guarded; scales to 19K by
 * cycling everyone through over a configurable window instead of one giant 24h burst.
 */
export async function runGapsCycle(): Promise<void> {
  if (gapsCycleRunning) return
  if (await isDownloadsPaused()) return
  const mon = await resolveMonitorSettings()
  if (Date.now() - lastGapsRunAt < Math.max(1, mon.gapsIntervalMin) * 60_000) return
  gapsCycleRunning = true
  lastGapsRunAt = Date.now()
  try {
    const batch = await prisma.artist.findMany({
      // Skip compound/junk artists: ';' splits the --only arg; '/' is a path separator in Rust.
      where: {
        monitored: true,
        musicbrainzId: { not: null },
        name: { not: { contains: ';' } },
        AND: { name: { not: { contains: '/' } } },
      },
      select: { id: true, name: true },
      orderBy: { lastGapsCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: Math.max(1, mon.gapsPicksPerRun),
    })
    if (batch.length === 0) return

    const root = process.env.PROJECT_ROOT || process.cwd()
    const binary = join(process.env.SCRIPTS_DIR || root, 'sync')
    try {
      // Serialized against merges/other script runs so it never hits the binaries' exclusive lock.
      await runExclusive(() => execFileAsync(
        binary, ['--catalogue-gaps', '--only', batch.map(a => a.name).join(';'), '--exact'],
        { cwd: root, maxBuffer: 1024 * 1024 * 64 },
      ))
    }
    catch (e: any) {
      const stderr = String(e?.stderr || '').trim()
      logWarn(`gaps batch failed: ${String(e?.message || e).split('\n')[0]}${stderr ? ` — ${stderr.split('\n')[0]}` : ''}`)
      // Stamp even on failure: without this, null-lastGapsCheckedAt artists always win the
      // orderBy and re-loop every tick. Stamping lets the rest of the catalogue cycle through;
      // these artists will be re-picked naturally after the full round-robin completes.
      await prisma.artist.updateMany({
        where: { id: { in: batch.map(a => a.id) } },
        data: { lastGapsCheckedAt: new Date() },
      })
      return
    }
    await prisma.artist.updateMany({
      where: { id: { in: batch.map(a => a.id) } },
      data: { lastGapsCheckedAt: new Date() },
    })
    log(`gaps: refreshed ${batch.length} artist(s)`)
  }
  catch (e: any) {
    logErr(`gaps cycle failed: ${e?.message || e}`)
  }
  finally {
    gapsCycleRunning = false
  }
}

/**
 * Optional hands-off merge: when `autoMergeDownloads` is enabled, batch-merge APPROVED downloads into
 * the library. Ships OFF (merge stays a manual gate by default). Throttled + guarded.
 */
export async function runAutoMergeCycle(): Promise<void> {
  if (autoMergeRunning) return
  if (await isDownloadsPaused()) return
  const { autoMergeDownloads } = await resolveDownloadSettings()
  if (!autoMergeDownloads) return
  if (Date.now() - lastAutoMergeAt < 120_000) return
  autoMergeRunning = true
  lastAutoMergeAt = Date.now()
  try {
    const ids = (await prisma.downloadedRelease.findMany({
      where: { status: 'APPROVED' }, select: { id: true }, take: 50,
    })).map(r => r.id)
    if (ids.length === 0) return
    const { merged } = await mergeManyDownloadedReleases(ids)
    if (merged) log(`auto-merge: ${merged} -> PROMOTED`)
  }
  catch (e: any) {
    logErr(`auto-merge failed: ${e?.message || e}`)
  }
  finally {
    autoMergeRunning = false
  }
}
