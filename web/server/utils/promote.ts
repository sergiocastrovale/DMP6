import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readdir, rename, copyFile, unlink, rm, rmdir } from 'node:fs/promises'
import { join, basename, dirname, relative, sep } from 'node:path'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'

const execFileAsync = promisify(execFile)

function musicDir(): string {
  return process.env.MUSIC_DIR || process.env.NUXT_MUSIC_DIR || ''
}

/** Run the Rust reconciler binary the same way the terminal endpoint resolves it. */
async function runReconciler(name: 'index' | 'sync', args: string[]): Promise<void> {
  const root = process.env.PROJECT_ROOT || process.cwd()
  const scriptsDir = process.env.SCRIPTS_DIR || root
  const binary = join(scriptsDir, name)
  await execFileAsync(binary, args, { cwd: root, maxBuffer: 1024 * 1024 * 64 })
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

/**
 * Merge an APPROVED download into the library: move APPROVED folder → MUSIC_DIR, reconcile
 * (index + sync), stamp provenance, mark PROMOTED.
 */
export async function mergeDownloadedRelease(id: string): Promise<{ localReleaseId: string | null }> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id }, include: { artist: true } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })
  if (!row.stagingPath) throw createError({ statusCode: 409, message: 'nothing to merge' })

  const music = musicDir()
  if (!music) throw createError({ statusCode: 503, message: 'MUSIC_DIR not configured' })

  const { downloadsApprovedPath } = await resolveDownloadSettings()
  const rel = relUnder(downloadsApprovedPath, row.stagingPath)
  const dest = join(music, rel)

  await moveDir(row.stagingPath, dest)

  // Reconcile just this folder/artist so it enters the normal release tables.
  await runReconciler('index', ['--folders', rel])
  if (row.artist?.name) {
    await runReconciler('sync', ['--only', row.artist.name, '--exact']).catch(() => {})
  }

  // Stamp provenance: the new LocalRelease should now be linked to the MISSING MB release.
  const lr = await prisma.localRelease.findFirst({
    where: row.mbReleaseId
      ? { releaseId: row.mbReleaseId }
      : { folderPath: { contains: basename(dest) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (lr) {
    await prisma.localRelease.update({ where: { id: lr.id }, data: { downloadedFrom: 'slskd' } })
  }
  await prisma.downloadedRelease.update({
    where: { id },
    data: { status: 'PROMOTED', localReleaseId: lr?.id ?? null },
  })

  return { localReleaseId: lr?.id ?? null }
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
