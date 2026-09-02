import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { slskdSearch, deleteSlskdSearch, startSlskdDownload } from '~/server/utils/slskd'
import { getSlskdResults } from '~/server/utils/downloads'
import { sanitize } from '~/server/utils/transcode'
import { normalizeTitle } from '~/server/utils/releaseTitle'
import type { DownloadSearchResult, AcquireResult, AcquireParams } from '~/types/download'

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// A free-text "artist album" search returns whatever a peer happens to have shared under that query —
// including completely unrelated folders (score is format/bitrate/speed only, never a title check). Reject
// candidates whose folder name has no meaningful overlap with the requested album title before scoring,
// so a high-bitrate wrong-album result can't outscore/replace a real (or simply absent) match.
export function albumFolderMatches(folderPath: string, albumTitle: string): boolean {
  const folder = normalizeTitle(folderPath.replace(/\\/g, '/').split('/').pop() || folderPath)
  const wanted = normalizeTitle(albumTitle)
  if (!wanted) {return true} // nothing to compare against — don't block on an empty title
  if (folder.includes(wanted) || wanted.includes(folder)) {return true}
  // Fall back to majority word overlap for near-matches (edition/remaster suffixes, minor reordering).
  const words = wanted.split(' ').filter(w => w.length >= 4)
  if (words.length === 0) {return folder.includes(wanted)}
  const hits = words.filter(w => folder.includes(w)).length
  return hits / words.length >= 0.6
}

/**
 * Run a Soulseek search and return the highest-scoring result whose folder plausibly matches the
 * requested album (or null), polling with an early exit once a strong (FLAC/high-score) or sufficient
 * set of results arrives.
 */
export async function findBestSlskdResult(
  artistName: string,
  albumTitle: string,
  allowedFormats?: string,
  minBitrate?: number,
): Promise<DownloadSearchResult | null> {
  const searchId = await slskdSearch(`${artistName} ${albumTitle}`.trim())
  let best: DownloadSearchResult | null = null
  try {
    for (let i = 0; i < 15; i++) {
      await sleep(2000)
      const results = (await getSlskdResults(searchId, allowedFormats, minBitrate))
        .filter(r => albumFolderMatches(r.folderPath, albumTitle))
      const top = [...results].sort((a, b) => b.score - a.score)[0]
      if (top) {
        best = top
        if (top.format === 'FLAC' && top.score >= 100) {break}
        if (i >= 4 && results.length >= 3) {break}
      }
    }
  }
  finally {
    deleteSlskdSearch(searchId).catch(() => {})
  }
  return best
}

/**
 * Create (or reuse) a DownloadedRelease (status DOWNLOADING) and enqueue the slskd transfer.
 * The persisted `files` list lets the reconciler (server/utils/monitorLoop.ts) finalize the
 * download — move + transcode to MP3-320 → READY/FAILED — independent of any in-memory state,
 * so it survives restarts and self-heals on every poll.
 * Pass `existingRowId` to reuse a pre-created row.
 */
export async function acquireRelease(params: AcquireParams, existingRowId?: string): Promise<{ id: string }> {
  const { downloadsPath } = await resolveDownloadSettings()
  if (!downloadsPath) {throw createError({ statusCode: 503, message: 'DOWNLOADS_PATH not configured' })}

  const quality = [params.result.format, params.result.avgBitrate || null]
    .filter(Boolean).join(' ').trim() || null
  const files = params.result.files.map(f => ({ filename: f.filename, size: f.size }))

  const data = {
    artistId: params.artistId ?? null,
    mbReleaseId: params.mbReleaseId ?? null,
    releaseGroupId: params.releaseGroupId ?? null,
    title: params.albumTitle,
    year: params.year ?? null,
    slskUsername: params.result.username,
    quality,
    files,
    status: 'DOWNLOADING' as const,
    error: null,
    bytesTransferred: BigInt(0),
    lastProgressAt: new Date(),
  }
  const row = existingRowId
    ? await prisma.downloadedRelease.update({ where: { id: existingRowId }, data })
    : await prisma.downloadedRelease.create({ data })

  // Create the artist parent folder up-front so in-flight downloads are legible on disk
  // (e.g. /…/dmp/Air/ appears as soon as we enqueue, before files land).
  await mkdir(join(downloadsPath, sanitize(params.artistName) || 'Unknown Artist'), { recursive: true }).catch(() => {})

  await startSlskdDownload(params.result.username, files)

  return { id: row.id }
}
