import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { slskdSearch, deleteSlskdSearch, startSlskdDownload } from '~/server/utils/slskd'
import { getSlskdResults } from '~/server/utils/downloads'
import { sanitize } from '~/server/utils/transcode'
import type { DownloadSearchResult } from '~/types/download'

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Run a Soulseek search and return the highest-scoring result (or null). Mirrors the
 * poll/early-exit heuristics of the manual stream endpoint.
 */
export async function findBestSlskdResult(
  query: string,
  allowedFormats?: string,
  minBitrate?: number,
): Promise<DownloadSearchResult | null> {
  const searchId = await slskdSearch(query)
  let best: DownloadSearchResult | null = null
  try {
    for (let i = 0; i < 15; i++) {
      await sleep(2000)
      const results = await getSlskdResults(searchId, allowedFormats, minBitrate)
      const top = [...results].sort((a, b) => b.score - a.score)[0]
      if (top) {
        best = top
        if (top.format === 'FLAC' && top.score >= 100) break
        if (i >= 4 && results.length >= 3) break
      }
    }
  }
  finally {
    deleteSlskdSearch(searchId).catch(() => {})
  }
  return best
}

// Only the fields acquireRelease actually needs — lets manual (dialog-picked) downloads,
// which know just the peer + files, route through the same recording path.
export type AcquireResult = Pick<DownloadSearchResult, 'username' | 'files'> &
  Partial<Pick<DownloadSearchResult, 'format' | 'avgBitrate'>>

export interface AcquireParams {
  result: AcquireResult
  artistId?: string | null
  artistName: string
  albumTitle: string
  year?: number | null
  mbReleaseId?: string | null
  releaseGroupId?: string | null
}

/**
 * Create (or reuse) a DownloadedRelease (status DOWNLOADING) and enqueue the slskd transfer.
 * The persisted `files` list lets the reconciler (server/utils/monitorLoop.ts) finalize the
 * download — move + transcode to MP3-320 → PENDING/FAILED — independent of any in-memory state,
 * so it survives restarts and self-heals on every poll.
 * Pass `existingRowId` to reuse a pre-created row.
 */
export async function acquireRelease(params: AcquireParams, existingRowId?: string): Promise<{ id: string }> {
  const { downloadsPath } = await resolveDownloadSettings()
  if (!downloadsPath) throw createError({ statusCode: 503, message: 'DOWNLOADS_PATH not configured' })

  const quality = [params.result.format, params.result.avgBitrate || null]
    .filter(Boolean).join(' ').trim() || null
  const files = params.result.files.map(f => ({ filename: f.filename, size: f.size }))

  const data = {
    artistId: params.artistId ?? null,
    mbReleaseId: params.mbReleaseId ?? null,
    releaseGroupId: params.releaseGroupId ?? null,
    title: params.albumTitle,
    year: params.year ?? null,
    source: 'SLSKD' as const,
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
