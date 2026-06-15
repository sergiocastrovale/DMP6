import { mkdir, readdir, rename, copyFile, unlink, rmdir } from 'node:fs/promises'
import { join, dirname, basename, sep } from 'node:path'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { collectAudioFiles, ext, probeTags, sanitize, type AudioTags } from '~/server/utils/transcode'
import { monitorLog } from '~/server/utils/monitorLog'

const log = (msg: string) => monitorLog('notice', `layout: ${msg}`)

/** Leading integer of a tag like "1" or "1/12"; NaN-safe. */
const parseLeadingInt = (s?: string): number => {
  const n = Number.parseInt(String(s ?? ''), 10)
  return Number.isFinite(n) ? n : 0
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Final `NN. Title.mp3` from tags, falling back to the existing basename when tags are missing. */
const fileNameFromTags = (tags: AudioTags, fallback: string): string => {
  const track = parseLeadingInt(tags.track)
  if (track > 0 && tags.title) {
    return `${pad2(track)}. ${sanitize(tags.title)}.mp3`
  }
  return fallback
}

/** Resolve the MusicBrainz album type name for a download, defaulting to "Album". */
const resolveAlbumType = async (mbReleaseId?: string | null, releaseGroupId?: string | null): Promise<string> => {
  if (mbReleaseId) {
    const rel = await prisma.musicBrainzRelease.findUnique({
      where: { id: mbReleaseId },
      select: { type: { select: { name: true } } },
    })
    if (rel?.type?.name) return rel.type.name
  }
  if (releaseGroupId) {
    const rel = await prisma.musicBrainzRelease.findFirst({
      where: { releaseGroupId },
      select: { type: { select: { name: true } } },
    })
    if (rel?.type?.name) return rel.type.name
  }
  return 'Album'
}

/** Move a single file, copy+unlink fallback for cross-device / permission-restricted mounts. */
const moveFile = async (src: string, dest: string): Promise<void> => {
  if (src === dest) return
  await mkdir(dirname(dest), { recursive: true })
  try {
    await rename(src, dest)
  }
  catch (e: any) {
    if (!['EXDEV', 'EACCES', 'EPERM'].includes(e?.code)) throw e
    await copyFile(src, dest)
    await unlink(src).catch(() => {})
  }
}

/** Best-effort removal of now-empty directories from startDir up to (not including) stopAt. */
const removeEmptyDirsUp = async (startDir: string, stopAt: string): Promise<void> => {
  const stop = stopAt.replace(/[/\\]+$/, '')
  let current = startDir
  while (current && current !== stop && current.startsWith(stop + sep)) {
    try {
      if ((await readdir(current)).length !== 0) return
      await rmdir(current)
    }
    catch { return }
    current = dirname(current)
  }
}

/**
 * Reorganize a finalized (transcoded + enriched) download into the library layout:
 *   {artist}/{album type}/{year} - {album}/{NN. Title}.mp3
 *   {artist}/{album type}/{year} - {album}/CD {NN}/{NN. Title}.mp3   (multi-disc only)
 * Filenames are re-derived from the (now SongKong-corrected) tags. Returns the new release-root
 * folder so the caller can persist it as the staging path for promotion.
 */
export const transformToLibraryLayout = async (
  downloadId: string,
  stagingDir: string,
): Promise<string> => {
  const row = await prisma.downloadedRelease.findUnique({
    where: { id: downloadId },
    include: { artist: { select: { name: true } } },
  })
  if (!row) throw new Error(`download ${downloadId} not found`)

  const { downloadsPath } = await resolveDownloadSettings()
  if (!downloadsPath) throw new Error('DOWNLOADS_PATH not configured')

  // Pass 1: probe every track (multi-disc detection + year fallback).
  const files = (await collectAudioFiles(stagingDir)).filter(f => ext(f) === 'mp3')
  const probed = await Promise.all(files.map(async f => ({ file: f, tags: await probeTags(f) })))
  const discTotal = probed.reduce(
    (max, p) => Math.max(max, parseLeadingInt(p.tags.discTotal), parseLeadingInt(p.tags.disc)),
    1,
  )

  const artist = sanitize(row.artist?.name || '') || 'Unknown Artist'
  const type = sanitize(await resolveAlbumType(row.mbReleaseId, row.releaseGroupId)) || 'Album'
  const album = sanitize(row.title) || 'Unknown Album'
  // Year from the matched MB release; fall back to the (enriched) file tags when MB has none.
  const year = row.year ?? (parseLeadingInt(probed.find(p => p.tags.year)?.tags.year) || null)
  const albumDir = year ? `${year} - ${album}` : album
  const releaseRoot = join(downloadsPath, artist, type, albumDir)

  // Pass 2: move each file into its destination.
  let moved = 0
  for (const { file, tags } of probed) {
    const discNo = parseLeadingInt(tags.disc) || 1
    const subDir = discTotal > 1 ? `CD ${pad2(discNo)}` : ''
    const dest = join(releaseRoot, subDir, fileNameFromTags(tags, basename(file)))
    try {
      await moveFile(file, dest)
      moved++
    }
    catch (e: any) {
      monitorLog('warn', `layout: failed to move ${basename(file)}: ${e?.message || e}`)
    }
  }

  // Carry over any non-audio extras (cover art, etc.) sitting alongside the tracks.
  for (const f of (await collectAudioFiles(stagingDir)).filter(f => ext(f) !== 'mp3')) {
    await moveFile(f, join(releaseRoot, basename(f))).catch(() => {})
  }

  // Clean up the old staging tree (now emptied) up to the downloads root.
  if (stagingDir !== releaseRoot) {
    await removeEmptyDirsUp(stagingDir, downloadsPath)
  }
  log(`${row.title}: ${moved}/${files.length} tracks -> ${releaseRoot}${discTotal > 1 ? ` (${discTotal} discs)` : ''}`)
  return releaseRoot
}
