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

/**
 * Approve & promote a staged download into the real library:
 *   move STAGING → MUSIC_DIR, reconcile (index + sync), stamp provenance.
 */
export async function promoteDownloadedRelease(id: string): Promise<{ localReleaseId: string | null }> {
  const row = await prisma.downloadedRelease.findUnique({
    where: { id },
    include: { artist: true },
  })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })
  if (!row.stagingPath) throw createError({ statusCode: 409, message: 'nothing staged to promote' })

  const music = musicDir()
  if (!music) throw createError({ statusCode: 503, message: 'MUSIC_DIR not configured' })

  const { downloadsPath } = await resolveDownloadSettings()
  // Preserve the same relative layout (Artist/Year - Album) under the library root.
  let rel = downloadsPath ? relative(downloadsPath, row.stagingPath) : ''
  if (!rel || rel.startsWith('..')) rel = basename(row.stagingPath)
  const dest = join(music, rel)

  await prisma.downloadedRelease.update({ where: { id }, data: { status: 'APPROVED' } })
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

/** Reject a staged download: delete the staged files and mark REJECTED. */
export async function rejectDownloadedRelease(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) throw createError({ statusCode: 404, message: 'download not found' })

  if (row.stagingPath) {
    const { downloadsPath } = await resolveDownloadSettings()
    // Safety: only delete inside the configured downloads/staging root.
    if (!downloadsPath || row.stagingPath.startsWith(downloadsPath + sep) || row.stagingPath === downloadsPath) {
      await rm(row.stagingPath, { recursive: true, force: true }).catch(() => {})
    }
  }
  await prisma.downloadedRelease.update({ where: { id }, data: { status: 'REJECTED' } })
}
