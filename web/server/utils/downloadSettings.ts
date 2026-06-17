import { prisma } from '~/server/utils/prisma'

/**
 * Resolves download-related settings, with DB values taking precedence over env vars.
 * Every setting can be configured in either place; DB wins if both are set.
 */
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

export const DEFAULT_DOWNLOAD_DIR_TEMPLATE = '{artist}/{year} - {album}'

// Subfolder under DOWNLOADS_PATH where qBittorrent saves torrents (dmp side of the shared mount).
// Excluded from the slsk relocate scan, alongside _ready / .dmp-songkong.
export const TORRENTS_SUBDIR = '_torrents'

export async function resolveDownloadSettings(): Promise<ResolvedDownloadSettings> {
  const settings = await prisma.settings.findUnique({ where: { id: 'main' } })

  const parsedBitrate = settings?.downloadMinBitrate
    ?? (process.env.DOWNLOAD_MIN_BITRATE ? parseInt(process.env.DOWNLOAD_MIN_BITRATE, 10) : null)

  const downloadsPath = settings?.downloadsPath || process.env.DOWNLOADS_PATH || ''
  const autoMerge = settings?.autoMergeDownloads
    ?? (process.env.AUTO_MERGE === 'true' || process.env.AUTO_MERGE === '1')
  const cleanDownloads = downloadsPath.replace(/\/+$/, '')

  return {
    slskdUrl: settings?.slskdUrl || process.env.SLSKD_URL || '',
    slskdApiKey: settings?.slskdApiKey || process.env.SLSKD_API_KEY || '',
    downloadFormats: settings?.downloadFormats || process.env.DOWNLOAD_FORMATS || '',
    downloadMinBitrate: Number.isFinite(parsedBitrate) ? parsedBitrate : null,
    downloadsPath,
    downloadDirTemplate: settings?.downloadDirTemplate
      || process.env.DOWNLOAD_DIR_TEMPLATE
      || DEFAULT_DOWNLOAD_DIR_TEMPLATE,
    // Derived, non-configurable: finished downloads auto-land here awaiting manual merge.
    downloadsReadyPath: downloadsPath ? `${cleanDownloads}/_ready` : '',
    // Derived (dmp side): where qBittorrent's torrent data lands on the shared mount.
    downloadsTorrentsPath: downloadsPath ? `${cleanDownloads}/${TORRENTS_SUBDIR}` : '',
    autoMergeDownloads: autoMerge,
    prowlarrUrl: settings?.prowlarrUrl || process.env.PROWLARR_URL || '',
    prowlarrApiKey: settings?.prowlarrApiKey || process.env.PROWLARR_API_KEY || '',
    prowlarrIndexerId: settings?.prowlarrIndexerId || process.env.PROWLARR_INDEXER_ID || '',
    qbittorrentUrl: settings?.qbittorrentUrl || process.env.QBITTORRENT_URL || '',
    qbittorrentUser: settings?.qbittorrentUser || process.env.QBITTORRENT_USER || '',
    qbittorrentPass: settings?.qbittorrentPass || process.env.QBITTORRENT_PASS || '',
    // qBit-side save prefix; defaults to the dmp-side path (works when both share the host folder
    // at the same container path). Override when qBit mounts the volume at a different prefix.
    qbittorrentSavePath: settings?.qbittorrentSavePath
      || process.env.QBITTORRENT_SAVE_PATH
      || (downloadsPath ? `${cleanDownloads}/${TORRENTS_SUBDIR}` : ''),
  }
}

export function resolveDownloadDir(
  template: string,
  artist: string,
  album: string,
  year: number | null | undefined,
): string {
  const sanitize = (s: string) => s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)

  // Replace placeholders. If {year} is missing, collapse surrounding separators.
  let rendered = template
    .replace(/\{artist\}/g, sanitize(artist) || 'Unknown Artist')
    .replace(/\{album\}/g, sanitize(album) || 'Unknown Album')

  if (year != null && Number.isFinite(year)) {
    rendered = rendered.replace(/\{year\}/g, String(year))
  }
  else {
    // Drop "{year}" and any adjacent " - " / " " / "_" padding.
    rendered = rendered.replace(/\s*[-_]\s*\{year\}/g, '')
      .replace(/\{year\}\s*[-_]\s*/g, '')
      .replace(/\{year\}/g, '')
  }

  // Sanitize each path segment individually to preserve slashes.
  return rendered
    .split(/[/\\]+/)
    .map(seg => sanitize(seg))
    .filter(Boolean)
    .join('/')
}
