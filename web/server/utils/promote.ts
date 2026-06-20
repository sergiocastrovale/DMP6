import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readdir, rename, unlink, rm, rmdir, access } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { join, basename, dirname, relative, sep } from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { getSlskdActiveDownloads, cancelSlskdDownload } from '~/server/utils/slskd'
import { deleteTorrent } from '~/server/utils/qbittorrent'
import { runExclusive } from '~/server/utils/scriptLock'
import { monitorLog } from '~/server/utils/monitorLog'
import { setMergeProgress, clearMergeProgress } from '~/server/utils/mergeProgress'

const execFileAsync = promisify(execFile)

function musicDir(): string {
  return process.env.MUSIC_DIR || process.env.NUXT_MUSIC_DIR || ''
}

/**
 * Run the Rust reconciler binary, serialized against every other script run in this process so it
 * never hits the binaries' exclusive DB lock (which hard-exits on contention).
 */
async function runReconciler(name: 'index' | 'sync', args: string[]): Promise<void> {
  const root = process.env.PROJECT_ROOT || process.cwd()
  const scriptsDir = process.env.SCRIPTS_DIR || root
  const binary = join(scriptsDir, name)
  await runExclusive(() => execFileAsync(binary, args, { cwd: root, maxBuffer: 1024 * 1024 * 64 }))
}

async function moveDir(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  try {
    await rename(src, dest)
    return
  }
  catch (e: any) {
    if (!['EXDEV', 'EACCES', 'EPERM', 'ENOTEMPTY'].includes(e?.code)) throw e
  }
  // Cross-device / permission fallback: copy file-by-file then remove the source tree. Use a streamed
  // read/write copy (NOT fs.copyFile) because copyFile uses the copy_file_range syscall, which returns
  // EPERM across distinct ZFS datasets on TrueNAS (staging on /mnt/SSD → library on /mnt/dmp).
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const ent of entries) {
    const from = join(src, ent.name)
    const to = join(dest, ent.name)
    if (ent.isDirectory()) await moveDir(from, to)
    else { await pipeline(createReadStream(from), createWriteStream(to)); await unlink(from).catch(() => {}) }
  }
  await rmdir(src).catch(() => {})
}

/** Relative layout path under a root; falls back to the folder basename if outside the root. */
function relUnder(root: string, full: string): string {
  const rel = root ? relative(root, full) : ''
  return !rel || rel.startsWith('..') ? basename(full) : rel
}

/**
 * Finalize a finished download: move it from the staging area into the `_ready` folder and mark it
 * READY (awaiting manual merge). No library write yet. Same relative layout is preserved so merge can
 * mirror it into MUSIC_DIR. This is the automatic, hands-off step — there is no approval gate.
 */
export async function moveToReady(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })

  // Erroneous release (no MusicBrainz year — can't lay it out as `YYYY - title`): never promote to
  // _ready. Purge the staged files and drop it into the Failed list. Safety net for anything that got
  // past the pick gate (in-flight at deploy, ENRICHING/torrent finalize).
  if (row.year == null) {
    await purgeStagedFiles(row.stagingPath)
    await prisma.downloadedRelease.update({
      where: { id },
      data: { status: 'FAILED', error: 'no MusicBrainz year — erroneous release', stagingPath: null },
    })
    monitorLog('warn', `merge: "${row.title}" has no MusicBrainz year — erroneous, sent to Failed`)
    return
  }

  if (!row.stagingPath) throw createError({ statusCode: 409, message: 'nothing staged' })

  const { downloadsPath, downloadsReadyPath } = await resolveDownloadSettings()
  if (!downloadsReadyPath) throw createError({ statusCode: 503, message: 'DOWNLOADS_PATH not configured' })

  // Already in the ready folder? just flag it.
  if (row.stagingPath.startsWith(downloadsReadyPath + sep) || row.stagingPath === downloadsReadyPath) {
    await prisma.downloadedRelease.update({ where: { id }, data: { status: 'READY' } })
    return
  }

  const dest = join(downloadsReadyPath, relUnder(downloadsPath, row.stagingPath))
  await moveDir(row.stagingPath, dest)
  await prisma.downloadedRelease.update({ where: { id }, data: { status: 'READY', stagingPath: dest } })
}

type MergeRow = {
  id: string
  title: string
  stagingPath: string | null
  mbReleaseId: string | null
  attempts: number
  priority: number
  artist: { name: string } | null
}

// Trailing disc subfolder (cd1 / disc 2 / disk3) — LocalRelease.folderPath is the rel path with this stripped.
const DISC_SEGMENT_RE = /[/\\](?:cd|disc|disk)\s*\d+\s*$/i
const stripDiscSegment = (rel: string): string => rel.replace(DISC_SEGMENT_RE, '')

// Delete a merged folder from disk, but only when it actually lives under MUSIC_DIR (safety guard).
async function purgeLibraryFolder(music: string, rel: string): Promise<void> {
  if (!music || !rel) return
  const full = join(music, rel)
  if (full.startsWith(music + sep)) {
    await rm(full, { recursive: true, force: true }).catch(() => {})
  }
}

// Move one ready release into MUSIC_DIR (idempotent: skip if already there) and return its rel path.
async function moveIntoLibrary(row: MergeRow, music: string, readyPath: string): Promise<string> {
  if (row.stagingPath!.startsWith(music + sep) || row.stagingPath === music) {
    return relUnder(music, row.stagingPath!) // already merged on disk; just (re)index in place
  }
  // Guard: the staged path MUST live under the ready folder. If not, the environment is misconfigured
  // (e.g. merging from a dev instance against the shared DB) — fail loudly instead of silently
  // basename-falling-back and writing to the wrong place under MUSIC_DIR.
  if (!row.stagingPath!.startsWith(readyPath + sep) && row.stagingPath !== readyPath) {
    throw createError({
      statusCode: 409,
      message: `staged path "${row.stagingPath}" is not under the ready folder "${readyPath}" — run merge where the files live (the NAS), not a dev instance`,
    })
  }
  // The staged folder must physically exist here. Two ways it can be absent: the files were already
  // moved/cleaned up out of _ready (orphaned READY row — merge can never succeed, reject it), or this is
  // a dev instance without the NAS downloads volume mounted. We can't tell them apart from access() alone,
  // so surface both and point at the fix instead of a raw ENOENT 500.
  await access(row.stagingPath!).catch(() => {
    throw createError({
      statusCode: 409,
      message: `Staged files not found at "${row.stagingPath}". They were already moved/cleaned up, or the downloads volume isn't mounted here (dev instance). If the files are gone, reject this download.`,
    })
  })
  const rel = relative(readyPath, row.stagingPath!)
  await moveDir(row.stagingPath!, join(music, rel))
  return rel
}

/**
 * Validate one merged release against MusicBrainz, then keep it (matched) or discard it (INVALID).
 * The match result is the validity gate:
 *   - `index --folders` already created the LocalRelease from the moved files;
 *   - `sync --release <id>` (targeted, so it SKIPS the destructive per-artist catalogue-gaps
 *     delete+recreate) tries to link it to a real MB edition via embedded MB tags and fetch the real
 *     tracks/status, setting LocalRelease.releaseId;
 *   - matched (releaseId set) -> stamp provenance, PROMOTED, retire the now-owned group placeholder;
 *   - unmatched (releaseId NULL) -> files have no MB identity -> delete folder + LocalRelease (cascade),
 *     mark the download INVALID (retryable until the attempts cap, then ABANDONED) so the trickle
 *     worker can hope a properly-tagged copy surfaces.
 * Returns { id: localReleaseId, error: null } on success, { id: null, error: reason } when invalidated.
 */
async function stampMerged(row: MergeRow, music: string, rel: string, maxDownloadAttempts: number): Promise<{ id: string | null; error: string | null }> {
  const stripped = stripDiscSegment(rel)
  const lr = await prisma.localRelease.findFirst({
    where: { OR: [{ folderPath: rel }, { folderPath: stripped }, { folderPath: { startsWith: stripped } }] },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  // Targeted reconcile of just this release (non-destructive: never touches sibling MISSING placeholders).
  if (lr) await runReconciler('sync', ['--release', lr.id]).catch(() => {})

  const reloaded = lr
    ? await prisma.localRelease.findUnique({ where: { id: lr.id }, select: { id: true, releaseId: true, matchStatus: true, forcedComplete: true } })
    : null

  // Keep only an exact match: every MusicBrainz track present and no extras (matchStatus COMPLETE).
  // forcedComplete is the manual "treat as complete" escape hatch — honour it. Anything else (partial,
  // extra-tracks, or no MB identity at all) is discarded and left to retry for a better copy.
  const matched = !!reloaded?.releaseId
  const complete = matched && (reloaded!.forcedComplete || reloaded!.matchStatus === 'COMPLETE')

  if (complete) {
    await prisma.$transaction([
      prisma.localRelease.update({ where: { id: reloaded!.id }, data: { downloadedFrom: 'slskd' } }),
      prisma.downloadedRelease.update({
        where: { id: row.id },
        data: { status: 'PROMOTED', stagingPath: join(music, rel), localReleaseId: reloaded!.id },
      }),
      // Retire the group placeholder we downloaded against — it's now owned on disk, so it must stop
      // being a pickable MISSING row (otherwise the re-download loop comes straight back).
      ...(row.mbReleaseId
        ? [prisma.musicBrainzRelease.deleteMany({ where: { id: row.mbReleaseId, status: 'MISSING' } })]
        : []),
    ])
    return { id: reloaded!.id, error: null }
  }

  // Discard: either no MusicBrainz identity, or matched but not an exact track-count match. Either way the
  // files are unusable for the library. Remove them and bump the attempt cap so a complete copy can still
  // surface later (the MISSING placeholder is deliberately NOT retired here).
  let reason = 'no MusicBrainz identity after enrichment'
  if (matched) {
    const [expected, present] = await Promise.all([
      prisma.musicBrainzReleaseTrack.count({ where: { releaseId: reloaded!.releaseId! } }),
      prisma.localReleaseTrack.count({ where: { localReleaseId: reloaded!.id } }),
    ])
    reason = `incomplete: ${present}/${expected} tracks (${reloaded!.matchStatus})`
  }

  await purgeLibraryFolder(music, rel)
  if (lr) await prisma.localRelease.delete({ where: { id: lr.id } }).catch(() => {})
  const attempts = (row.attempts ?? 0) + 1
  const abandoned = attempts >= Math.max(1, maxDownloadAttempts)
  await prisma.downloadedRelease.update({
    where: { id: row.id },
    data: {
      status: abandoned ? 'ABANDONED' : 'INVALID',
      attempts,
      priority: Math.max(0, (row.priority ?? 0) - 1),
      error: reason,
      stagingPath: null,
      files: Prisma.JsonNull,
    },
  })
  monitorLog('warn', `merge: "${row.artist?.name ?? '?'} - ${row.title}" ${reason} -> ${abandoned ? 'ABANDONED' : 'INVALID'}`)
  return { id: null, error: reason }
}

/**
 * Merge one READY download into the library: move READY → MUSIC_DIR (idempotent), reconcile
 * (index + sync, serialized), stamp provenance, mark PROMOTED.
 */
export async function mergeDownloadedRelease(id: string, emit?: (line: string) => void): Promise<{ localReleaseId: string | null; error: string | null }> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id }, include: { artist: { select: { name: true } } } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })
  if (!row.stagingPath) throw createError({ statusCode: 409, message: 'nothing to merge' })

  const music = musicDir()
  if (!music) throw createError({ statusCode: 503, message: 'MUSIC_DIR not configured' })
  const { downloadsReadyPath } = await resolveDownloadSettings()

  const { maxDownloadAttempts } = await resolveMonitorSettings()
  const title = row.title ?? '?'
  try {
    setMergeProgress(id, { step: 'moving', title })
    emit?.(`Moving "${title}" to library…`)
    const rel = await moveIntoLibrary(row, music, downloadsReadyPath)
    setMergeProgress(id, { step: 'indexing', title })
    emit?.(`Indexing "${title}"…`)
    await runReconciler('index', ['--folders', rel])
    setMergeProgress(id, { step: 'syncing', title })
    emit?.(`Syncing "${title}"…`)
    const { id: localReleaseId, error } = await stampMerged(row, music, rel, maxDownloadAttempts)
    if (localReleaseId) {
      emit?.(`✓ Merged "${title}"`)
    }
    else {
      emit?.(`✗ "${title}" invalidated: ${error}`)
    }
    return { localReleaseId, error }
  }
  finally {
    clearMergeProgress(id)
  }
}

/**
 * Batched merge of many READY downloads: move them all, then ONE index pass over all folders and
 * ONE sync per distinct artist (deduped) — far cheaper than per-release index+full-artist-sync, and
 * the whole thing runs serialized so it can't collide with the gaps worker on the Rust lock.
 */
export async function mergeManyDownloadedReleases(ids: string[], emit?: (line: string) => void): Promise<{ merged: number; errors: string[] }> {
  const music = musicDir()
  if (!music) throw createError({ statusCode: 503, message: 'MUSIC_DIR not configured' })
  const { downloadsReadyPath } = await resolveDownloadSettings()

  const rows = await prisma.downloadedRelease.findMany({
    where: { id: { in: ids }, status: 'READY' },
    include: { artist: { select: { name: true } } },
  })

  const errors: string[] = []
  const moved: { row: MergeRow; rel: string }[] = []
  try {
    for (const row of rows) {
      if (!row.stagingPath) {
        const msg = `"${row.title}" has no staging path — skipped`
        errors.push(msg)
        emit?.(`✗ ${msg}`)
        clearMergeProgress(row.id)
        continue
      }
      setMergeProgress(row.id, { step: 'moving', title: row.title })
      emit?.(`Moving "${row.title}" to library…`)
      try {
        moved.push({ row, rel: await moveIntoLibrary(row, music, downloadsReadyPath) })
      }
      catch (e: any) {
        const msg = `Move failed "${row.title}": ${e?.message || e}`
        monitorLog('error', `merge: ${msg}`)
        clearMergeProgress(row.id)
        errors.push(msg)
        emit?.(`✗ ${msg}`)
      }
    }
    if (moved.length === 0) {
      return { merged: 0, errors }
    }

    // One index over all folders (--folders is ';'-separated); skip paths containing ';'.
    for (const m of moved) setMergeProgress(m.row.id, { step: 'indexing', title: m.row.title })
    emit?.(`Indexing ${moved.length} release${moved.length === 1 ? '' : 's'}…`)
    const safeRels = moved.map(m => m.rel).filter(r => !r.includes(';'))
    if (safeRels.length) await runReconciler('index', ['--folders', safeRels.join(';')])
    for (const m of moved.filter(m => m.rel.includes(';'))) await runReconciler('index', ['--folders', m.rel])

    // Per-release targeted validate-or-invalidate (each runs its own `sync --release`, never a
    // destructive per-artist sync). Matched releases are kept + PROMOTED; unmatched go INVALID.
    const { maxDownloadAttempts } = await resolveMonitorSettings()
    let promoted = 0
    for (const m of moved) {
      setMergeProgress(m.row.id, { step: 'syncing', title: m.row.title })
      emit?.(`Syncing "${m.row.title}"…`)
      const { id: localReleaseId, error } = await stampMerged(m.row, music, m.rel, maxDownloadAttempts)
      if (localReleaseId) {
        promoted++
        emit?.(`✓ "${m.row.title}"`)
      }
      else {
        const msg = `"${m.row.title}" invalidated: ${error}`
        errors.push(msg)
        emit?.(`✗ ${msg}`)
      }
    }
    if (promoted > 0) emit?.(`✓ Merged ${promoted} release${promoted === 1 ? '' : 's'}`)
    return { merged: promoted, errors }
  }
  finally {
    for (const m of moved) clearMergeProgress(m.row.id)
  }
}

// slskd filenames can use backslash separators (Windows peers) — normalize before basename.
const baseName = (f: string) => basename(f.replace(/\\/g, '/'))

// Delete the staged folder from disk, but only inside the configured downloads/staging or ready
// roots (safety) — used by both reject and cancel.
async function purgeStagedFiles(stagingPath: string | null): Promise<void> {
  if (!stagingPath) return
  const { downloadsPath, downloadsReadyPath } = await resolveDownloadSettings()
  const inside = (root: string) => root && (stagingPath.startsWith(root + sep) || stagingPath === root)
  if (!downloadsPath || inside(downloadsPath) || inside(downloadsReadyPath)) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Count a reject/cancel against the shared `attempts` cap (MAX_DOWNLOAD_ATTEMPTS) and clear the staged
 * files reference:
 *   - below the cap -> back to FAILED (re-pickable after the retry cooldown), so the auto-downloader
 *     can fetch it again (a different source may be good).
 *   - at/above the cap -> REJECTED, a terminal tombstone excluded from pickCandidates, never re-fetched.
 * The counter accumulates across the whole download→ready→reject lifecycle, so the try/ready/reject
 * churn is bounded by N. A manual download from the artist page resets the cap (deliberate override).
 */
async function applyRejectionCap(row: { id: string; attempts: number }, reason: string): Promise<void> {
  const { maxDownloadAttempts } = await resolveMonitorSettings()
  const attempts = (row.attempts ?? 0) + 1
  const terminal = attempts >= Math.max(1, maxDownloadAttempts)
  await prisma.downloadedRelease.update({
    where: { id: row.id },
    data: { status: terminal ? 'REJECTED' : 'FAILED', attempts, error: reason, stagingPath: null, files: Prisma.JsonNull },
  })
}

/** Reject a staged download (FAILED or READY/ready-to-merge — identical outcome). */
export async function rejectDownloadedRelease(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })
  await purgeStagedFiles(row.stagingPath)
  await applyRejectionCap(row, 'rejected by user')
}

/**
 * Sweep the ready-to-merge queue for orphans: rows whose staged files no longer exist on disk (moved,
 * cleaned up, or never landed). Such rows can never be merged — delete them outright.
 *
 * Safety guard: this MUST run where the downloads volume is mounted (the NAS). If the ready root itself
 * is absent we're a dev instance without the volume — we can't distinguish "files gone" from "volume not
 * mounted", so we bail without touching anything rather than nuking the whole queue.
 */
export async function cleanupReadyDownloads(): Promise<{ removed: number; checked: number }> {
  const { downloadsReadyPath } = await resolveDownloadSettings()
  if (downloadsReadyPath) {
    const mounted = await access(downloadsReadyPath).then(() => true).catch(() => false)
    if (!mounted) {
      throw createError({
        statusCode: 409,
        message: `Downloads volume not mounted here ("${downloadsReadyPath}" absent) — run Cleanup on the NAS, not a dev instance.`,
      })
    }
  }

  const rows = await prisma.downloadedRelease.findMany({
    where: { status: 'READY', stagingPath: { not: null } },
    select: { id: true, stagingPath: true },
  })
  const orphans: string[] = []
  for (const row of rows) {
    const exists = await access(row.stagingPath!).then(() => true).catch(() => false)
    if (!exists) {
      orphans.push(row.id)
    }
  }
  if (orphans.length) {
    await prisma.downloadedRelease.deleteMany({ where: { id: { in: orphans } } })
    monitorLog('notice', `cleanup: removed ${orphans.length} ready-to-merge row(s) with missing staged files`)
  }
  return { removed: orphans.length, checked: rows.length }
}

/**
 * Cancel an in-flight download (DOWNLOADING/ENRICHING): kill the live slskd transfers and remove all of
 * its files, then count it against the same attempts cap as reject (below cap -> FAILED/re-downloadable,
 * at cap -> REJECTED/terminal). Same N-bounded outcome as FAILED/READY rejection.
 */
export async function cancelDownloadedRelease(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })

  const files = (row.files as Array<{ filename: string }> | null) ?? []
  if (row.source === 'RUTRACKER' && row.torrentHash) {
    // Delete the torrent + its data, but only if no other album from the same pack still needs it.
    const siblings = await prisma.downloadedRelease.count({
      where: { torrentHash: row.torrentHash, status: { in: ['DOWNLOADING', 'ENRICHING'] }, id: { not: row.id } },
    })
    if (siblings === 0) await deleteTorrent(row.torrentHash, true)
  }
  else if (row.slskUsername && files.length) {
    const transfers = await getSlskdActiveDownloads().catch(() => [])
    const expected = new Set(files.map(f => baseName(String(f.filename))))
    const ours = transfers.filter(t => t.username === row.slskUsername && expected.has(baseName(t.filename)))
    // remove=true tells slskd to delete the (partial) file as it cancels the transfer.
    for (const t of ours) await cancelSlskdDownload(row.slskUsername!, t.id).catch(() => {})
  }
  await purgeStagedFiles(row.stagingPath)
  await applyRejectionCap(row, 'cancelled by user')
}
