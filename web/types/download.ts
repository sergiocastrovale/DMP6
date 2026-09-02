import type { DownloadSource as PrismaDownloadSource } from '@prisma/client'

export type DownloadSource = 'slskd' | 'rutracker'

export type PauseReason = 'manual' | 'disk-full'

export interface MonitorEventItem {
  id: string
  level: 'warn' | 'error'
  message: string
  createdAt: string
  archivedAt: string | null
}

export interface MonitorEventCounts {
  flagged: number
  archived: number
}

export interface MonitorEventsResponse {
  items: MonitorEventItem[]
  counts: MonitorEventCounts
}

export type IssueEvent = Omit<MonitorEventItem, 'archivedAt'>

export type MonitorLevel = 'error' | 'warn' | 'notice'

export interface ResolvedMonitorSettings {
  monitorEnabled: boolean
  monitorIntervalMin: number
  monitorCap: number
  monitorGapsHours: number
  retryCooldownDays: number
  noProgressSec: number
  maxDownloadAttempts: number
  maxConcurrentDownloads: number
  searchPicksPerInterval: number
  searchIntervalSec: number
  gapsPicksPerRun: number
  gapsIntervalMin: number
  downloadsMinFreeGb: number
}

export type MergeStep = 'moving' | 'indexing' | 'syncing'

export interface MergeProgressEntry {
  step: MergeStep
  title: string
  destPath?: string
}

export type MergeProgressMap = Record<string, { step: MergeStep, title: string }>

export interface QbitConfig {
  url: string
  user: string
  pass: string
}

export interface QbitTorrentInfo {
  hash: string
  name: string
  state: string
  progress: number // 0..1
  size: number
  completed: number
  downloaded: number
  tags: string
}

export interface QbitFile {
  index: number
  name: string // path within the torrent
  size: number
  progress: number // 0..1
  priority: number
}

export interface ResolvedDownloadSettings {
  slskdUrl: string
  slskdApiKey: string
  downloadFormats: string
  downloadMinBitrate: number | null
  downloadsPath: string
  downloadDirTemplate: string
  downloadsReadyPath: string
  downloadsTorrentsPath: string
  autoMergeDownloads: boolean
  // RuTracker via Prowlarr (search) + qBittorrent (download)
  prowlarrUrl: string
  prowlarrApiKey: string
  prowlarrIndexerId: string
  qbittorrentUrl: string
  qbittorrentUser: string
  qbittorrentPass: string
  qbittorrentSavePath: string
}

export interface MatchableRelease {
  id: string
  title: string
  year: number | null
  releaseGroupId: string | null
}

export interface ProwlarrConfig {
  url: string
  apiKey: string
  indexerId: string
}

export interface ProwlarrRelease {
  title?: string
  size?: number
  seeders?: number
  leechers?: number
  downloadUrl?: string
  magnetUrl?: string
  guid?: string
  infoHash?: string
  indexer?: string
  protocol?: string
}

export interface TorrentAcquireParams {
  artistId: string
  artistName: string
  albumTitle: string
  year: number | null
  mbReleaseId: string | null
  releaseGroupId: string | null
}

export interface FolderMatch {
  release: MatchableRelease
  folder: string // torrent-relative directory of this album (what relocate scans / torrentFolder)
  fileIndexes: number[] // qBit file indexes belonging to this folder (for selective download)
  files: { filename: string, size: number }[] // audio files (basenames matter for relocate)
}

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
  | 'SEARCHING' | 'DOWNLOADING' | 'ENRICHING' | 'READY' | 'REJECTED' | 'PROMOTED' | 'FAILED' | 'ABANDONED' | 'UNAVAILABLE' | 'INVALID'

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
// Host SongKong drainer liveness — see server/utils/songkongHealth.ts. Surfaced so an ENRICHING row
// can explain itself instead of looking permanently stuck.
export interface SongkongHealth {
  enabled: boolean
  spoolCount: number
  oldestSpoolMin: number | null
  stalled: boolean
  maxWaitMin: number
}

export type DlStatusValue = { status: string, downloadedReleaseId: string, percent: number, bytesTransferred: number, totalBytes: number }

export type DlStatusItem = DlStatusValue & { mbReleaseId: string | null }

export interface DlInFlightItem {
  status: DownloadedReleaseStatus
  percent: number
  bytesTransferred: number
  totalBytes: number
}

export interface Acquisition {
  canAcquire: boolean
  rt: { enabled: boolean; used: number; limit: number; remaining: number; resetsAt: string | null }
  slsk: { enabled: boolean }
  // MISSING album/EP releases (of monitored artists) MusicBrainz gave no release date for — the
  // trickle worker requires a year to lay a release out as `YYYY - title`, so these are permanently
  // unacquirable and otherwise invisible. See docs/downloader_issues.md #15.
  noYearMissing: number
}

// Only the fields acquireRelease actually needs — a result that knows just the peer + files
// can route through the same recording path as a full search hit.
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

export interface MissingPick {
  id: string
  title: string
  year: number | null
  releaseGroupId: string | null
  artistId: string
  artistName: string
  rowId: string | null     // existing DownloadedRelease row (retry pool); null = fresh, create one
  attempts: number         // carried from the existing row (0 for fresh)
  priority: number         // carried from the existing row (10 for fresh)
  triedSources: ('SLSKD' | 'RUTRACKER')[] // no-retry sources already missed (carried; [] for fresh)
}

export interface DownloadProgressFields {
  percent: number
  bytesTransferred: number
  totalBytes: number
}

export interface SongkongHealthInput {
  enrichingRows: { updatedAt: Date }[] // rows currently ENRICHING
  lastDrainedAt: Date | null // last time any row was observed successfully enriched
  now?: Date
}

export interface SlskdConfig {
  url: string
  apiKey: string
}

export interface SlskdSearchResponse {
  username: string
  fileCount: number
  freeUploadSlots: number
  uploadSpeed: number
  queueLength: number
  files: SlskdFile[]
}

export interface SlskdFile {
  filename: string
  size: number
  bitRate?: number
  sampleRate?: number
  bitDepth?: number
  length?: number // seconds
}

export interface SlskdTransfer {
  id: string
  username: string
  filename: string
  size: number
  state: string
  bytesTransferred: number
  percentComplete: number
  averageSpeed: number
}

export interface SlskdMoveArgs {
  username: string
  files: { filename: string, size: number }[] // remote filenames + sizes as queued
  downloadsPath: string
  dirTemplate: string
  artistName: string
  albumTitle: string
  year: number | null
  // Where to look for the source files. Defaults to downloadsPath (slsk). Torrents pass the specific
  // album folder under DOWNLOADS_PATH/_torrents so basename matching can't collide across a pack.
  scanRoot?: string
}

export interface SlskdMoveResult {
  targetDir: string
  movedCount: number
  // Convertible (non-mp3) files that failed to transcode (ffmpeg missing/errored) and are left in
  // their original codec — the library layout only recognizes .mp3, so these are NOT usable tracks.
  // Callers must treat a nonzero count as a failed attempt, not a successful relocate.
  transcodeFailed: number
}

export type MergeRow = {
  id: string
  title: string
  stagingPath: string | null
  mbReleaseId: string | null
  releaseGroupId: string | null
  attempts: number
  priority: number
  source: PrismaDownloadSource
  artistId: string | null
  artist: { name: string } | null
}
