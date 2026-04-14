export type DownloadSource = 'slskd' | 'deezer' | 'hifi'

export interface SearchResult {
  id: string
  source: DownloadSource
  username: string
  folderPath: string
  files: SearchResultFile[]
  fileCount: number
  totalSize: number
  format: string
  avgBitrate: number
  score: number
  hasFreeSlot?: boolean
  queueLength?: number
  uploadSpeed?: number
}

export interface SearchResultFile {
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

export interface DownloadStatus {
  slskd: DownloadSourceStatus
  deezer: DownloadSourceStatus
  hifi: DownloadSourceStatus
}
