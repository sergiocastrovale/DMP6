import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readdir, rename, copyFile, unlink, rm, rmdir } from 'node:fs/promises'
import { join, basename, dirname, relative, sep } from 'node:path'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
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
  // Cross-device / permission fallback: copy file-by-file then remove the source tree.
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const ent of entries) {
    const from = join(src, ent.name)
    const to = join(dest, ent.name)
    if (ent.isDirectory()) await moveDir(from, to)
    else { await copyFile(from, to); await unlink(from).catch(() => {}) }
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

/** Reject a staged download: always remove the staged folder from disk AND delete the row. */
export async function rejectDownloadedRelease(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })

  if (row.stagingPath) {
    const { downloadsPath, downloadsApprovedPath } = await resolveDownloadSettings()
    // Safety: only delete inside the configured downloads/staging or approved roots.
    const inside = (root: string) => root && (row.stagingPath!.startsWith(root + sep) || row.stagingPath === root)
    if (!downloadsPath || inside(downloadsPath) || inside(downloadsApprovedPath)) {
      await rm(row.stagingPath, { recursive: true, force: true }).catch(() => {})
    }
  }
  await prisma.downloadedRelease.delete({ where: { id } })
}
