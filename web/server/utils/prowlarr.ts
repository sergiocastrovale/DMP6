import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import type { TorrentResult } from '~/types/download'

// Prowlarr is the *arr Torznab indexer proxy (the same instance Lidarr uses). RuTracker has no public
// API, so we search it through Prowlarr's normalized search endpoint and let qBittorrent fetch the
// torrent. The RT login lives in Prowlarr, not here — dmp only needs Prowlarr's URL + API key.

interface ProwlarrConfig {
  url: string
  apiKey: string
  indexerId: string
}

let configCache: (ProwlarrConfig & { cachedAt: number }) | null = null
const CACHE_TTL = 60_000

// Torznab music category (covers audio releases across indexers).
const MUSIC_CATEGORY = 3000

async function getProwlarrConfig(): Promise<ProwlarrConfig | null> {
  if (configCache && Date.now() - configCache.cachedAt < CACHE_TTL) {
    return { url: configCache.url, apiKey: configCache.apiKey, indexerId: configCache.indexerId }
  }
  const { prowlarrUrl, prowlarrApiKey, prowlarrIndexerId } = await resolveDownloadSettings()
  if (!prowlarrUrl || !prowlarrApiKey) {return null}

  configCache = {
    url: prowlarrUrl.replace(/\/$/, ''),
    apiKey: prowlarrApiKey,
    indexerId: prowlarrIndexerId,
    cachedAt: Date.now(),
  }
  return { url: configCache.url, apiKey: configCache.apiKey, indexerId: configCache.indexerId }
}

export function clearProwlarrConfigCache() {
  configCache = null
}

async function prowlarrFetch(path: string): Promise<Response> {
  const config = await getProwlarrConfig()
  if (!config) {throw createError({ statusCode: 503, message: 'Prowlarr not configured' })}

  const sep = path.includes('?') ? '&' : '?'
  const url = `${config.url}/api/v1${path}${sep}apikey=${encodeURIComponent(config.apiKey)}`
  const response = await fetch(url, { headers: { 'X-Api-Key': config.apiKey } })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw createError({ statusCode: response.status, message: `Prowlarr API error: ${response.status} ${text}`.trim() })
  }
  return response
}

export async function checkProwlarrConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = await getProwlarrConfig()
    if (!config) {return { ok: false, error: 'Prowlarr URL or API key not configured' }}
    const response = await prowlarrFetch('/health')
    if (!response.ok) {return { ok: false, error: `Prowlarr returned ${response.status}` }}
    return { ok: true }
  }
  catch (e: any) {
    return { ok: false, error: e.message || 'Connection failed' }
  }
}

/**
 * Did the RuTracker indexer just refuse a query because its daily limit is spent? Prowlarr enforces
 * RuTracker's hard 25-queries/24h cap (shared across every app pointed at it — Lidarr + dmp) and, when
 * exceeded, returns an EMPTY search result while logging the reason. We can't tell that apart from a
 * genuine no-match via the /search response, so we peek at the recent Prowlarr log instead. Reading the
 * log is NOT a search — it doesn't consume the cap. Returns false on any error (treat as a normal miss).
 */
export async function prowlarrRtLimited(): Promise<boolean> {
  try {
    const response = await prowlarrFetch('/log?page=1&pageSize=10&sortKey=time&sortDirection=descending')
    const data = (await response.json().catch(() => null)) as { records?: Array<{ message?: string }> } | null
    return (data?.records ?? []).some(r => /exceeding the maximum query limit/i.test(r.message ?? ''))
  }
  catch {
    return false
  }
}

const guessFormat = (title: string): string => {
  const t = title.toLowerCase()
  if (/\b(flac|lossless|ape|wav|alac)\b/.test(t)) {return 'FLAC'}
  if (/\b(mp3|320|256|cbr|vbr|v0)\b/.test(t)) {return 'MP3'}
  return 'Unknown'
}

interface ProwlarrRelease {
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

/**
 * Search Prowlarr for torrents matching `query`. Returns torrent results sorted by seeders DESC.
 * Restricted to the music category and (optionally) a single indexer id (the RuTracker indexer).
 */
export async function prowlarrSearch(query: string): Promise<TorrentResult[]> {
  const config = await getProwlarrConfig()
  if (!config) {return []}

  const params = new URLSearchParams({ query, type: 'search' })
  params.append('categories', String(MUSIC_CATEGORY))
  if (config.indexerId) {params.append('indexerIds', config.indexerId)}

  const response = await prowlarrFetch(`/search?${params.toString()}`)
  const data = (await response.json().catch(() => [])) as ProwlarrRelease[]
  if (!Array.isArray(data)) {return []}

  return data
    .filter(r => (r.protocol ?? 'torrent') === 'torrent')
    .map((r): TorrentResult => ({
      title: r.title || '',
      size: r.size || 0,
      seeders: r.seeders || 0,
      leechers: r.leechers || 0,
      // Prefer a direct magnet; otherwise the Prowlarr-proxied .torrent (downloadUrl) or guid.
      downloadUrl: r.magnetUrl || r.downloadUrl || r.guid || '',
      infoHash: r.infoHash || null,
      indexer: r.indexer || '',
      format: guessFormat(r.title || ''),
    }))
    .filter(r => r.downloadUrl)
    .sort((a, b) => b.seeders - a.seeders)
}
