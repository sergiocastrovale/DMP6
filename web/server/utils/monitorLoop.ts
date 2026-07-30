import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, rm, access } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { resolveSongkongEnabled, songkongDirs, songkongMaxWaitMin, isSongkongStalled, SONGKONG_STALE_AFTER_MIN } from '~/server/utils/songkongSettings'
import { transformToLibraryLayout } from '~/server/utils/layout'
import { moveToReady, mergeManyDownloadedReleases } from '~/server/utils/promote'
import { runExclusive } from '~/server/utils/scriptLock'
import { isDownloadsPaused } from '~/server/utils/pauseState'
import { monitorLog } from '~/server/utils/monitorLog'
import {
  getSlskdActiveDownloads,
  isSlskdTerminal,
  isSlskdFailed,
  cancelSlskdDownload,
  relocateDownloadedFiles,
  purgeDownloadedSourceFiles,
} from '~/server/utils/slskd'
import {
  getTorrentInfo,
  deleteTorrent,
  isQbitComplete,
  isQbitErrored,
} from '~/server/utils/qbittorrent'

const execFileAsync = promisify(execFile)

const log = (msg: string) => monitorLog('notice', msg)
const logWarn = (msg: string) => monitorLog('warn', msg)
const logErr = (msg: string) => monitorLog('error', msg)

let gapsCycleRunning = false
let lastGapsRunAt = 0
let autoMergeRunning = false
let lastAutoMergeAt = 0
let reconcileRunning = false
let torrentReconcileRunning = false
const finalizing = new Set<string>()

// SongKong drainer liveness (see songkongSettings.ts): updated whenever a row is observed actually
// enriched (not just timed out), and read before spooling any NEW completion into ENRICHING.
let lastSongkongDrainAt: Date | null = null
let songkongStalledLogged = false

/**
 * Is the SongKong drainer presumably down/backed up right now? If so, callers should skip spooling new
 * completions into ENRICHING (send them straight to READY instead) rather than let them each sit the
 * full max-wait window before self-promoting unenriched, one at a time.
 */
async function songkongBacklogStalled(): Promise<boolean> {
  const rows = await prisma.downloadedRelease.findMany({ where: { status: 'ENRICHING' }, select: { updatedAt: true } })
  const stalled = isSongkongStalled({ enrichingRows: rows, lastDrainedAt: lastSongkongDrainAt })
  if (stalled && !songkongStalledLogged) {
    songkongStalledLogged = true
    logWarn(`SongKong drainer appears stalled — ${rows.length} row(s) ENRICHING with no completion in the last ${SONGKONG_STALE_AFTER_MIN}min; new completions will skip enrichment until it recovers`)
  }
  else if (!stalled && songkongStalledLogged) {
    songkongStalledLogged = false
    log('SongKong drainer resumed')
  }
  return stalled
}

const baseName = (f: string) => basename(f.replace(/\\/g, '/'))

/**
 * Drive DOWNLOADING rows to their terminal state by checking slskd's actual transfer state —
 * the single owner of finalization. Idempotent, survives restarts, self-heals stuck rows.
 *  - transfers finished (or already gone) -> move + transcode -> READY (or FAILED if nothing landed)
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
      where: { status: { in: ['DOWNLOADING', 'ENRICHING'] }, source: 'SLSKD' },
      include: { artist: { select: { name: true } } },
    })
    if (rows.length === 0) return

    const settings = await resolveDownloadSettings()
    if (!settings.downloadsPath) return
    const mon = await resolveMonitorSettings()
    const maxAttempts = Math.max(1, mon.maxDownloadAttempts)
    const enrichRows = rows.filter(r => r.status === 'ENRICHING')
    const downloadingRows = rows.filter(r => r.status === 'DOWNLOADING')
    if (enrichRows.length > 0) {
      finalized += await drainEnriching(enrichRows, maxAttempts)
    }
    if (downloadingRows.length === 0) {
      if (failed || finalized) log(`reconcile done: ${finalized} -> READY, ${failed} -> FAILED/ABANDONED`)
      return
    }
    // Distinguish "slskd unreachable" from "genuinely no active transfers" — swallowing the fetch error
    // into an empty array would make every DOWNLOADING row look like its transfer already finished
    // (ours=[] -> active=false -> falls straight into finalize/fail), prematurely failing live downloads
    // during a transient slskd outage instead of just waiting for the next tick.
    let transfersUnknown = false
    const transfers = await withTimeout(getSlskdActiveDownloads(), 15_000).catch(() => { transfersUnknown = true; return [] })
    if (transfersUnknown) {
      logWarn(`reconcile: slskd unreachable — skipping finalize for ${downloadingRows.length} downloading row(s) this tick`)
      if (failed || finalized) log(`reconcile done: ${finalized} -> READY, ${failed} -> FAILED/ABANDONED`)
      return
    }

    const ORPHAN_MIN = 3                              // file-less row stuck this long = restart orphan
    const noProgressMs = Math.max(15, mon.noProgressSec) * 1000
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

      // Peer disconnected mid-download: slskd flips the transfer(s) to a failed terminal state
      // (Errored / TimedOut / Cancelled / Rejected). One drop kills the whole peer, so treat ANY
      // failed transfer as a dead download — cancel stragglers, fail + purge immediately. No grace
      // wait, no partial-sibling promotion: a fresh retry re-fetches the lot.
      if (ours.some(t => isSlskdFailed(t.state))) {
        for (const t of ours) { await cancelSlskdDownload(row.slskUsername!, t.id).catch(() => {}) }
        await failAttempt(row, maxAttempts, 'slskd transfer failed (peer disconnected)')
        await purgeDownloadedSourceFiles(settings.downloadsPath, files).catch(() => {})
        failed++
        continue
      }

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
          files,
          downloadsPath: settings.downloadsPath,
          dirTemplate: settings.downloadDirTemplate,
          artistName: row.artist.name,
          albumTitle: row.title,
          year: row.year ?? null,
        }), 5 * 60_000)
        if (res.movedCount > 0) {
          if (await resolveSongkongEnabled() && !(await songkongBacklogStalled())) {
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
          await purgeDownloadedSourceFiles(settings.downloadsPath, files).catch(() => {})
          failed++
        }
      }
      catch (e: any) {
        await failAttempt(row, maxAttempts, String(e?.message || e).slice(0, 500))
        await purgeDownloadedSourceFiles(settings.downloadsPath, files).catch(() => {})
        failed++
      }
      finally {
        finalizing.delete(row.id)
      }
    }
    if (failed || finalized) log(`reconcile done: ${finalized} -> READY, ${failed} -> FAILED/ABANDONED`)
  }
  catch (e: any) {
    logErr(`reconcile failed: ${e?.message || e}`)
  }
  finally {
    reconcileRunning = false
  }
}

// Finalize a finished download: record the staged layout, then automatically move it into the
// `_ready` folder and mark it READY ("Ready to merge"). No approval gate — the only manual step left
// is the merge into MUSIC_DIR.
//
// If moveToReady throws, the files already landed successfully at `stagingPath` — only the last hop
// into `_ready` failed (permissions, disk, misconfig). Previously this error was swallowed and the row
// was left stranded at its current status (DOWNLOADING/ENRICHING) forever, silently re-entering the
// same finalize path every tick. Route it through the normal attempts-cap machinery instead, keeping
// stagingPath intact (the folder is good — never purge it here) so it surfaces in Failed instead of
// vanishing from view.
async function settleFinished(id: string, stagingPath: string, error: string | null): Promise<void> {
  await prisma.downloadedRelease.update({ where: { id }, data: { stagingPath, error } })
  try {
    await moveToReady(id)
  }
  catch (e: any) {
    const row = await prisma.downloadedRelease.findUnique({ where: { id }, select: { attempts: true, priority: true } })
    const { maxDownloadAttempts } = await resolveMonitorSettings()
    const msg = `move-to-ready failed (files safe at ${stagingPath}): ${e?.message || e}`
    logErr(`settleFinished ${id}: ${msg}`)
    await failAttempt(
      { id, attempts: row?.attempts ?? 0, priority: row?.priority ?? 10 },
      Math.max(1, maxDownloadAttempts),
      msg,
      stagingPath,
    )
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ])
}

// Increment the attempt counter; after maxAttempts give up permanently (ABANDONED). Also lowers
// priority (floor 0) so a repeatedly-failing download sinks behind fresher candidates on retry.
async function failAttempt(
  row: { id: string; attempts: number; priority?: number },
  maxAttempts: number,
  error: string,
  stagingPath?: string,
) {
  const attempts = (row.attempts ?? 0) + 1
  await prisma.downloadedRelease.update({
    where: { id: row.id },
    data: {
      attempts,
      priority: Math.max(0, (row.priority ?? 10) - 1),
      status: attempts >= maxAttempts ? 'ABANDONED' : 'FAILED',
      error,
      ...(stagingPath ? { stagingPath } : {}),
    },
  }).catch(() => {})
}

/**
 * Drive ENRICHING rows to READY. A row stays ENRICHING until the host SongKong drainer writes a
 * `done/<id>` marker, then we run the library-layout transform. If the marker never appears within
 * the max-wait window (drainer down / SongKong stuck), we promote unenriched rather than strand the
 * download. File-based + idempotent, so it survives restarts. Returns rows finalized to READY.
 */
async function drainEnriching(
  rows: Array<{ id: string; title: string; stagingPath: string | null; updatedAt: Date; attempts: number; priority: number }>,
  maxAttempts: number,
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

    if (enriched) lastSongkongDrainAt = new Date() // the drainer is alive and producing output

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
      const msg = `layout transform failed: ${String(e?.message || e).slice(0, 300)}`
      logErr(`reconcile: ${row.title} ${msg}`)
      // Route through the attempts cap instead of leaving the row ENRICHING forever — once timedOut
      // flips true this branch would otherwise re-enter (and re-fail) every single tick, uncapped.
      await failAttempt(row, maxAttempts, msg)
    }
    finally {
      finalizing.delete(row.id)
    }
  }
  return done
}

/**
 * Torrent counterpart of reconcileDownloads for `source='RUTRACKER'` rows (downloaded via qBittorrent).
 * Rows are grouped by `torrentHash` because one torrent (a discography pack) can fill several albums at
 * once. For each torrent:
 *  - track byte progress; no progress past the grace window -> delete torrent + fail the group;
 *  - errored in qBittorrent -> delete + fail;
 *  - selected files complete -> relocate each album's folder into staging (-> READY or ENRICHING),
 *    then delete the torrent + its data (we've moved out everything we wanted — nothing should linger).
 * ENRICHING rows drain through the same SongKong path as slsk (source-agnostic). Idempotent + guarded.
 */
export async function reconcileTorrentDownloads(): Promise<void> {
  if (torrentReconcileRunning) return
  torrentReconcileRunning = true
  try {
    const rows = await prisma.downloadedRelease.findMany({
      where: { status: { in: ['DOWNLOADING', 'ENRICHING'] }, source: 'RUTRACKER' },
      include: { artist: { select: { name: true } } },
    })
    if (rows.length === 0) return

    const settings = await resolveDownloadSettings()
    if (!settings.downloadsTorrentsPath) return

    const mon = await resolveMonitorSettings()
    const maxAttempts = Math.max(1, mon.maxDownloadAttempts)

    // ENRICHING rows finalize identically to slsk (keyed on stagingPath, source-agnostic).
    const enrichRows = rows.filter(r => r.status === 'ENRICHING')
    if (enrichRows.length > 0) await drainEnriching(enrichRows, maxAttempts)

    const dlRows = rows.filter(r => r.status === 'DOWNLOADING' && r.torrentHash)
    if (dlRows.length === 0) return

    const noProgressMs = Math.max(15, mon.noProgressSec) * 1000

    const byHash = new Map<string, typeof dlRows>()
    for (const r of dlRows) {
      const list = byHash.get(r.torrentHash!) || []
      list.push(r)
      byHash.set(r.torrentHash!, list)
    }

    const infos = await withTimeout(getTorrentInfo([...byHash.keys()]), 15_000).catch(() => [])
    const infoByHash = new Map(infos.map(i => [i.hash.toLowerCase(), i]))
    log(`torrent reconcile: ${dlRows.length} downloading across ${byHash.size} torrent(s)`)

    for (const [hash, group] of byHash) {
      const info = infoByHash.get(hash.toLowerCase())
      if (!info) {
        for (const r of group) await failAttempt(r, maxAttempts, 'torrent no longer in qBittorrent')
        continue
      }
      if (isQbitErrored(info)) {
        await deleteTorrent(hash, true)
        for (const r of group) await failAttempt(r, maxAttempts, `qBittorrent error: ${info.state}`)
        continue
      }

      if (!isQbitComplete(info)) {
        const head = group[0]!
        const bytes = info.downloaded || 0
        const watermark = Number(head.bytesTransferred || 0)
        const lastProgress = (head.lastProgressAt ?? head.updatedAt).getTime()
        if (bytes > watermark) {
          await prisma.downloadedRelease.updateMany({
            where: { torrentHash: hash, status: 'DOWNLOADING' },
            data: { bytesTransferred: BigInt(bytes), lastProgressAt: new Date() },
          }).catch(() => {})
          continue
        }
        if (Date.now() - lastProgress <= noProgressMs) continue
        await deleteTorrent(hash, true)
        for (const r of group) await failAttempt(r, maxAttempts, `no progress for ${mon.noProgressSec}s`)
        continue
      }

      // Complete: relocate every matched album folder, then delete the torrent + its data.
      let finalized = 0
      for (const r of group) {
        if (finalizing.has(r.id)) continue
        if (!r.artist?.name || !r.torrentFolder) { await failAttempt(r, maxAttempts, 'missing artist or torrent folder'); continue }
        finalizing.add(r.id)
        try {
          const files = (r.files as Array<{ filename: string; size: number }> | null) ?? []
          const res = await withTimeout(relocateDownloadedFiles({
            username: '',
            files,
            downloadsPath: settings.downloadsPath,
            scanRoot: join(settings.downloadsTorrentsPath, r.torrentFolder),
            dirTemplate: settings.downloadDirTemplate,
            artistName: r.artist.name,
            albumTitle: r.title,
            year: r.year ?? null,
          }), 5 * 60_000)
          if (res.movedCount > 0) {
            if (await resolveSongkongEnabled() && !(await songkongBacklogStalled())) {
              const dirs = songkongDirs()
              await mkdir(dirs.spool, { recursive: true })
              await writeFile(join(dirs.spool, r.id), `${res.targetDir}\n`)
              await prisma.downloadedRelease.update({ where: { id: r.id }, data: { status: 'ENRICHING', stagingPath: res.targetDir, error: null } })
            }
            else {
              const releaseRoot = await transformToLibraryLayout(r.id, res.targetDir)
              await settleFinished(r.id, releaseRoot, null)
              finalized++
            }
          }
          else {
            await failAttempt(r, maxAttempts, 'no files landed from torrent', res.targetDir)
          }
        }
        catch (e: any) {
          await failAttempt(r, maxAttempts, String(e?.message || e).slice(0, 500))
        }
        finally {
          finalizing.delete(r.id)
        }
      }
      // Everything we wanted has been relocated out; the torrent is no longer needed.
      await deleteTorrent(hash, true)
      if (finalized) log(`torrent reconcile: ${finalized} -> ready (hash ${hash.slice(0, 8)})`)
    }
  }
  catch (e: any) {
    logErr(`torrent reconcile failed: ${e?.message || e}`)
  }
  finally {
    torrentReconcileRunning = false
  }
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
      const detail = `${String(e?.message || e).split('\n')[0]}${stderr ? ` — ${stderr.split('\n')[0]}` : ''}`
      // Lock contention = another script (a merge here, or a manual ./index/./sync run outside this
      // process) held the Rust DB lock. Nothing was actually checked, so DON'T stamp — leave these
      // artists at the front of the round-robin so the very next tick retries them once the lock frees.
      const lockHeld = /lock held|Cannot start/i.test(`${e?.message || ''} ${stderr}`)
      if (lockHeld) {
        logWarn(`gaps batch skipped (lock busy), will retry: ${detail}`)
        return
      }
      logWarn(`gaps batch failed: ${detail}`)
      // Genuine failure: stamp anyway, else null-lastGapsCheckedAt artists always win the orderBy and
      // re-loop every tick. Stamping lets the rest of the catalogue cycle through; these artists get
      // re-picked naturally after the full round-robin completes.
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
 * Optional hands-off merge: when `autoMergeDownloads` is enabled, batch-merge READY downloads into
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
      where: { status: 'READY' }, select: { id: true }, take: 50,
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
