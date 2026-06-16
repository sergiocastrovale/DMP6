export type DownloadSource = 'slskd'

export interface DownloadSearchResult {
  id: string
  source: DownloadSource
  username: string
  folderPath: string
  files: DownloadSearchResultFile[]
  fileCount: number
  totalSize: number
  format: string
  avgBitrate: number
  score: number
  hasFreeSlot?: boolean
  queueLength?: number
  uploadSpeed?: number
}

export interface DownloadSearchResultFile {
  filename: string
  size: number
  bitRate?: number
  duration?: number
}

export interface ActiveDownload {
  id: string
  source: DownloadSource
  username: string
  filename: string
  size: number
  bytesTransferred: number
  percentComplete: number
  state: string
  averageSpeed: number
}

export interface DownloadSourceStatus {
  configured: boolean
  connected: boolean
  error?: string
}

export type DownloadedReleaseStatus =
  | 'DOWNLOADING' | 'ENRICHING' | 'READY' | 'REJECTED' | 'PROMOTED' | 'FAILED' | 'ABANDONED' | 'UNAVAILABLE' | 'INVALID'

export interface DownloadedReleaseItem {
  id: string
  artist: string | null
  artistSlug: string | null
  title: string
  year: number | null
  source: string
  slskUsername: string | null
  quality: string | null
  status: DownloadedReleaseStatus
  attempts?: number
  priority?: number
  error: string | null
  stagingPath: string | null
  mbReleaseId: string | null
  releaseGroupId: string | null
  localReleaseId: string | null
  releaseType: string | null
  createdAt: string
  updatedAt: string
  percent: number
  bytesTransferred: number
  totalBytes: number
}

// Minimal per-release progress shape consumed by DownloadProgress.vue (aggregate mode).
export interface ReleaseProgress {
  status: DownloadedReleaseStatus
  percent: number
  bytesTransferred?: number
  totalBytes?: number
}
