import type { DownloadStatus } from '@prisma/client'

export interface DownloadProgressFields {
  percent: number
  bytesTransferred: number
  totalBytes: number
}

// Statuses where the transfer is finished (download complete) -> bar is full.
const COMPLETED: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  'ENRICHING', 'READY', 'PROMOTED',
])

/**
 * Per-release download progress from the byte watermark (updated every reconcile tick) and the
 * queued file sizes. One rule, shared by the queue + artist-page endpoints so they agree.
 * DOWNLOADING is capped at 99 until it flips to a completed status (avoids a premature 100%).
 */
export const computeDownloadPercent = (row: {
  status: DownloadStatus
  bytesTransferred: bigint | number | null
  files: unknown
}): DownloadProgressFields => {
  const bytesTransferred = Number(row.bytesTransferred ?? 0)
  const files = Array.isArray(row.files) ? row.files as Array<{ size?: number }> : []
  const totalBytes = files.reduce((sum, f) => sum + (Number(f?.size) || 0), 0)

  let percent: number
  if (COMPLETED.has(row.status)) {
    percent = 100
  }
  else if (row.status === 'DOWNLOADING') {
    percent = totalBytes > 0 ? Math.min(99, Math.round((bytesTransferred / totalBytes) * 100)) : 0
  }
  else {
    // FAILED / ABANDONED: best-effort last known fraction.
    percent = totalBytes > 0 ? Math.min(100, Math.round((bytesTransferred / totalBytes) * 100)) : 0
  }

  return { percent, bytesTransferred, totalBytes }
}
