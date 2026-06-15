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
import { runExclusive } from '~/server/utils/scriptLock'
import { monitorLog } from '~/server/utils/monitorLog'

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
 * Approve a finished download: move it from the staging area into the APPROVED folder (awaiting
 * merge). No library write yet. Same relative layout is preserved so merge can mirror it into MUSIC_DIR.
 */
export async function approveDownloadedRelease(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })
  if (!row.stagingPath) throw createError({ statusCode: 409, message: 'nothing staged to approve' })

  const { downloadsPath, downloadsApprovedPath } = await resolveDownloadSettings()
  if (!downloadsApprovedPath) throw createError({ statusCode: 503, message: 'DOWNLOADS_APPROVED_FOLDER not configured' })

  // Already in the approved folder? just flag it.
  if (row.stagingPath.startsWith(downloadsApprovedPath + sep) || row.stagingPath === downloadsApprovedPath) {
    await prisma.downloadedRelease.update({ where: { id }, data: { status: 'APPROVED' } })
    return
  }

  const dest = join(downloadsApprovedPath, relUnder(downloadsPath, row.stagingPath))
  await moveDir(row.stagingPath, dest)
  await prisma.downloadedRelease.update({ where: { id }, data: { status: 'APPROVED', stagingPath: dest } })
}

type MergeRow = { id: string; stagingPath: string | null; mbReleaseId: string | null; artist: { name: string } | null }

// Move one approved release into MUSIC_DIR (idempotent: skip if already there) and return its rel path.
async function moveIntoLibrary(row: MergeRow, music: string, approvedPath: string): Promise<string> {
  if (row.stagingPath!.startsWith(music + sep) || row.stagingPath === music) {
    return relUnder(music, row.stagingPath!) // already merged on disk; just (re)index in place
  }
  // Guard: the staged path MUST live under the configured approved folder. If not, the environment
  // is misconfigured (e.g. merging from a dev instance against the shared DB) — fail loudly instead
  // of silently basename-falling-back and writing to the wrong place under MUSIC_DIR.
  if (!row.stagingPath!.startsWith(approvedPath + sep) && row.stagingPath !== approvedPath) {
    throw createError({
      statusCode: 409,
      message: `staged path "${row.stagingPath}" is not under the approved folder "${approvedPath}" — run merge where the files live (the NAS), not a dev instance`,
    })
  }
  // The staged folder must physically exist here. On a dev instance the NAS downloads volume isn't
  // mounted, so the path is valid but absent -> fail clearly instead of a raw ENOENT 500.
  await access(row.stagingPath!).catch(() => {
    throw createError({
      statusCode: 409,
      message: `staged files not found at "${row.stagingPath}" — run merge on the NAS where the downloads volume is mounted, not a dev instance`,
    })
  })
  const rel = relative(approvedPath, row.stagingPath!)
  await moveDir(row.stagingPath!, join(music, rel))
  return rel
}

// Stamp provenance + PROMOTED for one merged release.
async function stampMerged(row: MergeRow, music: string, rel: string): Promise<string | null> {
  const lr = await prisma.localRelease.findFirst({
    where: row.mbReleaseId ? { releaseId: row.mbReleaseId } : { folderPath: { contains: basename(join(music, rel)) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (lr) await prisma.localRelease.update({ where: { id: lr.id }, data: { downloadedFrom: 'slskd' } })
  await prisma.downloadedRelease.update({
    where: { id: row.id },
    data: { status: 'PROMOTED', stagingPath: join(music, rel), localReleaseId: lr?.id ?? null },
  })
  return lr?.id ?? null
}

/**
 * Merge one APPROVED download into the library: move APPROVED → MUSIC_DIR (idempotent), reconcile
 * (index + sync, serialized), stamp provenance, mark PROMOTED.
 */
export async function mergeDownloadedRelease(id: string): Promise<{ localReleaseId: string | null }> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id }, include: { artist: { select: { name: true } } } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })
  if (!row.stagingPath) throw createError({ statusCode: 409, message: 'nothing to merge' })

  const music = musicDir()
  if (!music) throw createError({ statusCode: 503, message: 'MUSIC_DIR not configured' })
  const { downloadsApprovedPath } = await resolveDownloadSettings()

  const rel = await moveIntoLibrary(row, music, downloadsApprovedPath)
  await runReconciler('index', ['--folders', rel])
  if (row.artist?.name) await runReconciler('sync', ['--only', row.artist.name, '--exact']).catch(() => {})
  return { localReleaseId: await stampMerged(row, music, rel) }
}

/**
 * Batched merge of many APPROVED downloads: move them all, then ONE index pass over all folders and
 * ONE sync per distinct artist (deduped) — far cheaper than per-release index+full-artist-sync, and
 * the whole thing runs serialized so it can't collide with the gaps worker on the Rust lock.
 */
export async function mergeManyDownloadedReleases(ids: string[]): Promise<{ merged: number }> {
  const music = musicDir()
  if (!music) throw createError({ statusCode: 503, message: 'MUSIC_DIR not configured' })
  const { downloadsApprovedPath } = await resolveDownloadSettings()

  const rows = await prisma.downloadedRelease.findMany({
    where: { id: { in: ids }, status: 'APPROVED' },
    include: { artist: { select: { name: true } } },
  })

  const moved: { row: MergeRow; rel: string }[] = []
  for (const row of rows) {
    if (!row.stagingPath) continue
    try { moved.push({ row, rel: await moveIntoLibrary(row, music, downloadsApprovedPath) }) }
    catch (e: any) { monitorLog('error', `merge: move failed ${row.title}: ${e?.message || e}`) }
  }
  if (moved.length === 0) return { merged: 0 }

  // One index over all folders (--folders is ';'-separated); skip paths containing ';'.
  const safeRels = moved.map(m => m.rel).filter(r => !r.includes(';'))
  if (safeRels.length) await runReconciler('index', ['--folders', safeRels.join(';')])
  for (const m of moved.filter(m => m.rel.includes(';'))) await runReconciler('index', ['--folders', m.rel])

  // One sync per distinct artist.
  const artists = [...new Set(moved.map(m => m.row.artist?.name).filter(Boolean) as string[])]
  for (const name of artists) await runReconciler('sync', ['--only', name, '--exact']).catch(() => {})

  for (const m of moved) await stampMerged(m.row, music, m.rel)
  return { merged: moved.length }
}

// slskd filenames can use backslash separators (Windows peers) — normalize before basename.
const baseName = (f: string) => basename(f.replace(/\\/g, '/'))

// Delete the staged folder from disk, but only inside the configured downloads/staging or approved
// roots (safety) — used by both reject and cancel.
async function purgeStagedFiles(stagingPath: string | null): Promise<void> {
  if (!stagingPath) return
  const { downloadsPath, downloadsApprovedPath } = await resolveDownloadSettings()
  const inside = (root: string) => root && (stagingPath.startsWith(root + sep) || stagingPath === root)
  if (!downloadsPath || inside(downloadsPath) || inside(downloadsApprovedPath)) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Count a reject/cancel against the shared `attempts` cap (MAX_DOWNLOAD_ATTEMPTS) and clear the staged
 * files reference:
 *   - below the cap -> back to FAILED (re-pickable after the retry cooldown), so the auto-downloader
 *     can fetch it again (a different source may be good).
 *   - at/above the cap -> REJECTED, a terminal tombstone excluded from pickCandidates, never re-fetched.
 * The counter accumulates across the whole download→approve→reject lifecycle, so the try/approve/reject
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

/** Reject a staged download (FAILED or APPROVED/ready-to-merge — identical outcome). */
export async function rejectDownloadedRelease(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })
  await purgeStagedFiles(row.stagingPath)
  await applyRejectionCap(row, 'rejected by user')
}

/**
 * Cancel an in-flight download (DOWNLOADING/ENRICHING): kill the live slskd transfers and remove all of
 * its files, then count it against the same attempts cap as reject (below cap -> FAILED/re-downloadable,
 * at cap -> REJECTED/terminal). Same N-bounded outcome as FAILED/APPROVED rejection.
 */
export async function cancelDownloadedRelease(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })

  const files = (row.files as Array<{ filename: string }> | null) ?? []
  if (row.slskUsername && files.length) {
    const transfers = await getSlskdActiveDownloads().catch(() => [])
    const expected = new Set(files.map(f => baseName(String(f.filename))))
    const ours = transfers.filter(t => t.username === row.slskUsername && expected.has(baseName(t.filename)))
    // remove=true tells slskd to delete the (partial) file as it cancels the transfer.
    for (const t of ours) await cancelSlskdDownload(row.slskUsername!, t.id).catch(() => {})
  }
  await purgeStagedFiles(row.stagingPath)
  await applyRejectionCap(row, 'cancelled by user')
}
