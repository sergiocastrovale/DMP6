import type { ActiveDownload, DownloadSearchResult } from '~/types/download'
import {
  checkSlskdConnection,
  getSlskdSearchResults,
  getSlskdActiveDownloads,
  cancelSlskdDownload,
  isAudioFile,
  detectFormat,
  scoreSlskdResult,
} from '~/server/utils/slskd'

export async function getDownloadStatus() {
  const slskd = await checkSlskdConnection().catch(() => ({ ok: false, error: 'Connection failed' }))

  return {
    slskd: { configured: slskd.ok || !slskd.error?.includes('not configured'), connected: slskd.ok, error: slskd.error },
  }
}

// --- Search ---

export async function getSlskdResults(searchId: string, allowedFormats?: string, minBitrate?: number): Promise<DownloadSearchResult[]> {
  const responses = await getSlskdSearchResults(searchId)
  const results: DownloadSearchResult[] = []

  const formatSet = allowedFormats
    ? new Set(allowedFormats.split(',').map(f => f.trim().toLowerCase()))
    : null

  for (const resp of responses) {
    const audioFiles = (resp.files || []).filter(f => isAudioFile(f.filename))
    if (audioFiles.length === 0) { continue }

    const groups = new Map<string, typeof audioFiles>()
    for (const file of audioFiles) {
      const parts = file.filename.replace(/\\/g, '/').split('/')
      const dir = parts.slice(0, -1).join('/')
      const existing = groups.get(dir) || []
      existing.push(file)
      groups.set(dir, existing)
    }

    for (const [dir, files] of groups) {
      const formatCounts = new Map<string, number>()
      let totalBitrate = 0
      let bitrateCount = 0

      for (const f of files) {
        const fmt = detectFormat(f.filename)
        formatCounts.set(fmt, (formatCounts.get(fmt) || 0) + 1)
        if (f.bitRate) {
          totalBitrate += f.bitRate
          bitrateCount++
        }
      }

      let dominantFormat = 'Unknown'
      let maxCount = 0
      for (const [fmt, count] of formatCounts) {
        if (count > maxCount) {
          dominantFormat = fmt
          maxCount = count
        }
      }

      const avgBitrate = bitrateCount > 0 ? Math.round(totalBitrate / bitrateCount) : 0

      if (formatSet && !formatSet.has(dominantFormat.toLowerCase())) { continue }
      if (minBitrate && avgBitrate > 0 && avgBitrate < minBitrate) { continue }

      const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0)
      const hasFreeSlot = resp.freeUploadSlots > 0
      const score = scoreSlskdResult(
        dominantFormat, avgBitrate, files.length,
        resp.uploadSpeed, resp.queueLength, hasFreeSlot,
      )

      results.push({
        id: `${resp.username}:${dir}`,
        source: 'slskd',
        username: resp.username,
        folderPath: dir,
        files: files.map(f => ({
          filename: f.filename,
          size: f.size,
          bitRate: f.bitRate,
          duration: f.length ? f.length * 1000 : undefined,
        })),
        fileCount: files.length,
        totalSize,
        format: dominantFormat,
        avgBitrate,
        score,
        hasFreeSlot,
        queueLength: resp.queueLength,
        uploadSpeed: resp.uploadSpeed,
      })
    }
  }

  results.sort((a, b) => {
    if (a.hasFreeSlot !== b.hasFreeSlot) { return a.hasFreeSlot ? -1 : 1 }
    return (b.uploadSpeed || 0) - (a.uploadSpeed || 0)
  })
  return results
}

// --- Downloads ---

export async function getAllActiveDownloads(): Promise<ActiveDownload[]> {
  const slskdTransfers = await getSlskdActiveDownloads().catch(() => [])

  return slskdTransfers.map(t => ({
    id: t.id,
    source: 'slskd' as const,
    username: t.username,
    filename: t.filename,
    size: t.size,
    bytesTransferred: t.bytesTransferred,
    percentComplete: t.percentComplete,
    state: t.state,
    averageSpeed: t.averageSpeed,
  }))
}

export async function cancelDownloadBySource(
  username: string,
  id: string,
): Promise<void> {
  await cancelSlskdDownload(username, id)
}
