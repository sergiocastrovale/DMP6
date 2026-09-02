import type { DownloadStatus } from '@prisma/client'
import type { DownloadProgressFields } from '~/types/download'

// Statuses where the transfer is finished (download complete) -> bar is full.
const COMPLETED: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  'ENRICHING', 'READY', 'PROMOTED',
])

/**
 * Per-release download progress from the byte watermark (updated every reconcile tick) and the
 * queued file sizes. One rule, shared by the queue + artist-page endpoints so they agree.
 * DOWNLOADING is capped at 99 until it flips to a completed status (avoids a premature 100%).
 */
// Sum of `{ size }[]` file entries stored on a DownloadedRelease row - shared with the torrent
// reconciler so a multi-album pack's whole-torrent byte count can be split proportionally per row
// instead of being written identically onto every album sharing the torrent.
export const sumFileBytes = (files: unknown): number => {
  const arr = Array.isArray(files) ? files as Array<{ size?: number }> : []
  return arr.reduce((sum, f) => sum + (Number(f?.size) || 0), 0)
}

export const computeDownloadPercent = (row: {
  status: DownloadStatus
  bytesTransferred: bigint | number | null
  files: unknown
}): DownloadProgressFields => {
  const bytesTransferred = Number(row.bytesTransferred ?? 0)
  const totalBytes = sumFileBytes(row.files)

  let percent: number
  if (COMPLETED.has(row.status)) {
    percent = 100
  }
  else if (row.status === 'DOWNLOADING') {
    percent = totalBytes > 0 ? Math.min(99, Math.round((bytesTransferred / totalBytes) * 100)) : 0
  }
  else if (row.status === 'SEARCHING') {
    // No files/bytes yet - nothing to show a fraction of.
    percent = 0
  }
  else {
    // FAILED / ABANDONED: best-effort last known fraction.
    percent = totalBytes > 0 ? Math.min(100, Math.round((bytesTransferred / totalBytes) * 100)) : 0
  }

  return { percent, bytesTransferred, totalBytes }
}
