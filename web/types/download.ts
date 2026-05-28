export type DownloadSource = 'slskd' | 'deezer' | 'hifi'

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

export type DownloadStatus = Record<DownloadSource, DownloadSourceStatus>
