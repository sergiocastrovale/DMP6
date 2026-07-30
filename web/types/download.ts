export type DownloadSource = 'slskd' | 'rutracker'

// A torrent search hit normalized from Prowlarr's Torznab feed.
export interface TorrentResult {
  title: string
  size: number
  seeders: number
  leechers: number
  // What we hand to qBittorrent: a magnet link or a Prowlarr-proxied .torrent download URL.
  downloadUrl: string
  infoHash: string | null
  indexer: string
  // crude quality/format guess derived from the title (FLAC > MP3 > unknown)
  format: string
}

// One DownloadSourceConfig row (the /downloads header switches + retry policy).
export interface DownloadSourceConfigItem {
  name: 'SLSKD' | 'RUTRACKER'
  url: string | null
  retry: boolean
  enabled: boolean
}

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
  torrentHash: string | null
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

// Why the background acquisition workers are (or aren't) running — drives the /downloads idle banner.
export interface Acquisition {
  canAcquire: boolean
  rt: { enabled: boolean; used: number; limit: number; remaining: number; resetsAt: string | null }
  slsk: { enabled: boolean }
  // MISSING album/EP releases (of monitored artists) MusicBrainz gave no release date for — the
  // trickle worker requires a year to lay a release out as `YYYY - title`, so these are permanently
  // unacquirable and otherwise invisible. See docs/downloader_issues.md #15.
  noYearMissing: number
}
