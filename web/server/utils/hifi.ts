import { createWriteStream, mkdirSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDownloadDir } from '~/server/utils/downloadSettings'

// Public HiFi API instances (Tidal/Qobuz proxy — no auth required)
const DEFAULT_INSTANCES = [
  'https://triton.squid.wtf',
  'https://hifi-one.spotisaver.net',
  'https://hifi-two.spotisaver.net',
  'https://hund.qqdl.site',
  'https://katze.qqdl.site',
  'https://arran.monochrome.tf',
]

// Quality tiers
const QUALITY_MAP: Record<string, { apiValue: string; label: string; ext: string; bitrate: number }> = {
  hires:    { apiValue: 'HI_RES_LOSSLESS', label: 'FLAC 24-bit/96kHz', ext: 'flac', bitrate: 9216 },
  lossless: { apiValue: 'LOSSLESS',        label: 'FLAC 16-bit/44.1kHz', ext: 'flac', bitrate: 1411 },
  high:     { apiValue: 'HIGH',            label: 'AAC 320kbps',         ext: 'm4a', bitrate: 320 },
  low:      { apiValue: 'LOW',             label: 'AAC 96kbps',          ext: 'm4a', bitrate: 96 },
}
const QUALITY_FALLBACK = ['lossless', 'high', 'low'] as const

const MIN_AUDIO_SIZE = 100 * 1024 // 100KB
const MIN_INTERVAL = 500 // ms between API calls

let _instances = [...DEFAULT_INSTANCES]
let _currentIdx = 0
let _lastRequest = 0

// Active downloads tracking
const _activeDownloads = new Map<string, HifiDownloadState>()

interface HifiDownloadState {
  id: string
  trackId: string
  displayName: string
  state: string
  progress: number
  size: number
  transferred: number
  speed: number
  filePath: string | null
  error: string | null
}

async function rateLimit() {
  const elapsed = Date.now() - _lastRequest
  if (elapsed < MIN_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL - elapsed))
  }
  _lastRequest = Date.now()
}

function currentInstance(): string {
  return (_instances[_currentIdx] || _instances[0])!
}

function rotateInstance() {
  _currentIdx = (_currentIdx + 1) % _instances.length
}

async function hifiFetch(path: string, timeoutMs = 15000): Promise<any | null> {
  await rateLimit()

  const tried = new Set<number>()
  while (tried.size < _instances.length) {
    const instance = currentInstance()
    tried.add(_currentIdx)

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      const response = await fetch(`${instance}${path}`, {
        headers: {
          'User-Agent': 'DMP/1.0',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (response.status >= 500) {
        rotateInstance()
        continue
      }
      if (!response.ok) return null

      const data = await response.json()
      if (data?.error) {
        console.warn(`HiFi API error: ${data.error}`)
        return null
      }
      return data
    }
    catch {
      rotateInstance()
    }
  }
  return null
}

export async function checkHifiConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = await hifiFetch('/', 5000)
    if (data !== null) return { ok: true }
    return { ok: false, error: 'All HiFi API instances unreachable' }
  }
  catch (e: any) {
    return { ok: false, error: e.message || 'Connection failed' }
  }
}

// --- Search ---

export interface HifiTrack {
  id: string
  title: string
  artist: string
  album: string
  duration: number // seconds
  trackNumber: number
  quality: string
}

export interface HifiAlbumResult {
  id: string
  title: string
  artist: string
  trackCount: number
  tracks: HifiTrack[]
}

function parseTrack(item: any): HifiTrack | null {
  if (!item) return null

  const id = String(item.id || '')
  if (!id) return null

  // Artist can be string, object, or array
  let artist = 'Unknown'
  if (typeof item.artist === 'string') artist = item.artist
  else if (item.artist?.name) artist = item.artist.name
  else if (Array.isArray(item.artists)) {
    artist = item.artists
      .map((a: any) => (typeof a === 'string' ? a : a?.name || ''))
      .filter(Boolean)
      .join(', ') || 'Unknown'
  }

  // Album can be string or object
  let album = ''
  if (typeof item.album === 'string') album = item.album
  else if (item.album?.title) album = item.album.title
  else if (item.album?.name) album = item.album.name

  return {
    id,
    title: item.title || 'Unknown',
    artist,
    album,
    duration: item.duration || 0,
    trackNumber: item.trackNumber || item.track_number || 0,
    quality: item.audioQuality || item.quality || '',
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2)
}

// Jaccard-like overlap that rewards query tokens found in the target.
function titleMatchScore(query: string, target: string, artistTokens: Set<string>): number {
  const q = tokenize(query).filter(t => !artistTokens.has(t))
  const tgt = new Set(tokenize(target))
  if (q.length === 0 || tgt.size === 0) return 0
  let matched = 0
  for (const tok of q) if (tgt.has(tok)) matched++
  return matched / q.length
}

function parseAlbum(item: any): HifiAlbumResult | null {
  if (!item) return null
  const id = String(item.id || '')
  if (!id) return null

  let artist = 'Unknown'
  if (typeof item.artist === 'string') artist = item.artist
  else if (item.artist?.name) artist = item.artist.name
  else if (Array.isArray(item.artists)) {
    artist = item.artists
      .map((a: any) => (typeof a === 'string' ? a : a?.name || ''))
      .filter(Boolean)
      .join(', ') || 'Unknown'
  }

  return {
    id,
    title: item.title || 'Unknown',
    artist,
    trackCount: item.numberOfTracks || item.trackCount || 0,
    tracks: [],
  }
}

// Unwrap tidal's `{ type, item }` wrappers if present.
function unwrap(x: any): any {
  return x && typeof x === 'object' && 'item' in x && 'type' in x ? x.item : x
}

function extractSearchAlbums(data: any): any[] {
  if (!data) return []
  const d = data.data ?? data
  const albums = d?.albums
  if (!albums) return []
  if (Array.isArray(albums)) return albums.map(unwrap)
  if (Array.isArray(albums.items)) return albums.items.map(unwrap)
  return []
}

function extractSearchTracks(data: any): any[] {
  if (!data) return []
  const d = data.data ?? data
  // flat single-type search (s=) → d.items
  if (Array.isArray(d?.items) && d.items[0] && !('tracks' in d) && !('albums' in d)) {
    return d.items.map(unwrap)
  }
  const tracks = d?.tracks
  if (!tracks) return []
  if (Array.isArray(tracks)) return tracks.map(unwrap)
  if (Array.isArray(tracks.items)) return tracks.items.map(unwrap)
  return []
}

function stripArtistPrefix(query: string, artist: string): string {
  const qTokens = tokenize(query)
  const aTokens = tokenize(artist)
  let i = 0
  while (i < aTokens.length && i < qTokens.length && qTokens[i] === aTokens[i]) i++
  if (i === 0) return query
  // Rebuild query preserving original casing by chopping matched prefix length.
  const lower = query.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  let charIdx = 0
  let consumed = 0
  while (charIdx < lower.length && consumed < i) {
    while (charIdx < lower.length && /[^a-z0-9]/.test(lower[charIdx]!)) charIdx++
    while (charIdx < lower.length && /[a-z0-9]/.test(lower[charIdx]!)) charIdx++
    consumed++
  }
  return query.slice(charIdx).replace(/^[^A-Za-z0-9]+/, '').trim() || query
}

async function searchAlbumsStructured(query: string, artist?: string): Promise<any[]> {
  if (artist) {
    const albumQuery = stripArtistPrefix(query, artist)
    // Try up to 3 instances — some mirrors return 0 results while others work.
    for (let attempt = 0; attempt < 3; attempt++) {
      const params = new URLSearchParams({ al: albumQuery, a: artist, limit: '20' })
      const data = await hifiFetch(`/search/?${params}`)
      const albums = extractSearchAlbums(data)
      if (albums.length > 0) return albums
      rotateInstance()
    }
  }
  // Fallback: flat search with combined query, then pull albums from response
  const combined = artist && !tokenize(query).some(t => tokenize(artist).includes(t))
    ? `${artist} ${query}`
    : query
  const params = new URLSearchParams({ s: combined, limit: '20' })
  const data = await hifiFetch(`/search/?${params}`)
  // `s=` alone usually returns a tracks-style flat list; try albums shape too.
  const albums = extractSearchAlbums(data)
  if (albums.length > 0) return albums
  // Derive albums from track results.
  const tracks = extractSearchTracks(data)
  const albumsById = new Map<string, any>()
  for (const t of tracks) {
    const a = t?.album
    if (!a || typeof a !== 'object' || !a.id) continue
    if (!albumsById.has(String(a.id))) albumsById.set(String(a.id), a)
  }
  return Array.from(albumsById.values())
}

export async function hifiSearchAlbumResults(
  query: string,
  artist?: string,
  limit = 8,
): Promise<HifiAlbumResult[]> {
  const rawAlbums = await searchAlbumsStructured(query, artist)
  const artistTokens = new Set(artist ? tokenize(artist) : [])

  const scored: { album: HifiAlbumResult; score: number }[] = []
  for (const raw of rawAlbums) {
    const album = parseAlbum(raw)
    if (!album) continue
    const score = titleMatchScore(query, album.title, artistTokens)
    if (score > 0) scored.push({ album, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(s => s.album)
}

export async function hifiSearchAlbum(query: string, artist?: string): Promise<HifiTrack[]> {
  // Find matching albums, then fetch tracks for the best matches.
  const matches = await hifiSearchAlbumResults(query, artist, 3)
  if (matches.length === 0) {
    // Fallback to flat track search, but filter by relevance so we don't return
    // unrelated tracks that happen to match common words in the query.
    const combined = artist ? `${artist} ${query}` : query
    const params = new URLSearchParams({ s: combined, limit: '20' })
    const data = await hifiFetch(`/search/?${params}`)
    const artistTokens = new Set(artist ? tokenize(artist) : [])
    const albumQuery = artist ? stripArtistPrefix(query, artist) : query
    const tracks = extractSearchTracks(data)
      .map(parseTrack)
      .filter((t): t is HifiTrack => t !== null)
    return tracks.filter((t) => {
      if (artist && titleMatchScore(artist, t.artist, new Set()) < 0.5) return false
      if (t.album && titleMatchScore(albumQuery, t.album, artistTokens) > 0) return true
      return titleMatchScore(albumQuery, t.title, artistTokens) > 0
    })
  }

  const all: HifiTrack[] = []
  for (const album of matches) {
    const tracks = await hifiGetAlbumTracks(album.id)
    for (const t of tracks) {
      // Ensure album title is populated from the search result if parseTrack missed it.
      if (!t.album) t.album = album.title
      all.push(t)
    }
  }
  return all
}

export async function hifiGetAlbumTracks(albumId: string): Promise<HifiTrack[]> {
  const data = await hifiFetch(`/album/?id=${albumId}&limit=100`)
  if (!data) return []

  const albumData = data.data ?? data
  // /album/ returns `items: [{ type: 'track', item: {...} }]`
  const rawItems: any[] = Array.isArray(albumData?.items)
    ? albumData.items
    : Array.isArray(albumData?.tracks?.items)
      ? albumData.tracks.items
      : Array.isArray(albumData?.tracks)
        ? albumData.tracks
        : []

  return rawItems
    .map(entry => parseTrack(unwrap(entry)))
    .filter((t): t is HifiTrack => t !== null && t.id !== '')
}

// --- Stream URL ---

interface StreamInfo {
  url: string
  mimeType: string
  codec: string
  quality: string
  ext: string
}

async function getStreamUrl(trackId: string, quality = 'lossless'): Promise<StreamInfo | null> {
  const q = QUALITY_MAP[quality]
  if (!q) return null

  const data = await hifiFetch(`/track/?id=${trackId}&quality=${q.apiValue}`)
  if (!data) return null

  const manifest = data.data?.manifest || data.manifest
  if (!manifest) return null

  try {
    const decoded = JSON.parse(Buffer.from(manifest, 'base64').toString('utf-8'))
    const urls = decoded.urls
    if (!urls || !Array.isArray(urls) || urls.length === 0) return null

    const codec = (decoded.codecs || decoded.codec || '').toLowerCase()
    let ext = q.ext
    if (codec === 'flac') ext = 'flac'
    else if (codec === 'mp4a' || codec === 'aac') ext = 'm4a'

    return {
      url: urls[0],
      mimeType: decoded.mimeType || '',
      codec,
      quality,
      ext,
    }
  }
  catch {
    return null
  }
}

// --- Download ---

export async function startHifiDownload(
  trackIds: string[],
  downloadsPath: string,
  albumTitle?: string,
  artistName?: string,
  year?: number | null,
  dirTemplate?: string,
): Promise<string> {
  const groupId = `hifi-${Date.now()}`

  const albumDir = artistName && albumTitle && dirTemplate
    ? join(downloadsPath, resolveDownloadDir(dirTemplate, artistName, albumTitle, year))
    : join(downloadsPath, `hifi-${Date.now()}`)
  mkdirSync(albumDir, { recursive: true })

  for (const trackId of trackIds) {
    const dlId = `${groupId}-${trackId}`
    _activeDownloads.set(dlId, {
      id: dlId,
      trackId,
      displayName: `Track ${trackId}`,
      state: 'Queued',
      progress: 0,
      size: 0,
      transferred: 0,
      speed: 0,
      filePath: null,
      error: null,
    })

    downloadTrack(dlId, trackId, albumDir).catch((e) => {
      const dl = _activeDownloads.get(dlId)
      if (dl) { dl.state = 'Errored'; dl.error = e.message }
    })
  }

  return groupId
}

async function downloadTrack(dlId: string, trackId: string, albumDir: string) {
  const dl = _activeDownloads.get(dlId)
  if (!dl) return

  dl.state = 'Initializing'

  // Get track info for filename
  const info = await hifiFetch(`/info/?id=${trackId}`)
  if (info) {
    const track = parseTrack(info.data ?? info)
    if (track) {
      dl.displayName = `${track.artist} - ${track.title}`
    }
  }

  // Try quality with fallback
  let stream: StreamInfo | null = null
  for (const q of QUALITY_FALLBACK) {
    stream = await getStreamUrl(trackId, q)
    if (stream) break
  }

  if (!stream) {
    dl.state = 'Errored'
    dl.error = 'No stream URL available'
    return
  }

  const prefix = dl.displayName !== `Track ${trackId}` ? '' : ''
  const safeName = sanitize(dl.displayName)
  const outPath = join(albumDir, `${safeName}.${stream.ext}`)

  dl.state = 'InProgress'

  // Download the stream
  const response = await fetch(stream.url, {
    headers: { 'User-Agent': 'DMP/1.0' },
  })
  if (!response.ok || !response.body) {
    dl.state = 'Errored'
    dl.error = `Download failed: HTTP ${response.status}`
    return
  }

  const totalSize = Number(response.headers.get('content-length') || 0)
  dl.size = totalSize

  const reader = response.body.getReader()
  const fileStream = createWriteStream(outPath)
  let downloaded = 0
  const startTime = Date.now()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      fileStream.write(Buffer.from(value))
      downloaded += value.length
      dl.transferred = downloaded
      if (totalSize > 0) dl.progress = (downloaded / totalSize) * 100
      const elapsed = (Date.now() - startTime) / 1000
      if (elapsed > 0) dl.speed = Math.round(downloaded / elapsed)
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end(() => resolve())
      fileStream.on('error', reject)
    })

    // Validate file size
    try {
      const stat = statSync(outPath)
      if (stat.size < MIN_AUDIO_SIZE) {
        unlinkSync(outPath)
        dl.state = 'Errored'
        dl.error = 'Downloaded file too small — likely an error'
        return
      }
    }
    catch { /* ignore stat errors */ }

    dl.state = 'Completed'
    dl.progress = 100
    dl.transferred = downloaded
    dl.filePath = outPath
  }
  catch (e: any) {
    dl.state = 'Errored'
    dl.error = e.message
    fileStream.destroy()
  }
}

export function getHifiActiveDownloads(): HifiDownloadState[] {
  return Array.from(_activeDownloads.values())
}

export function cancelHifiDownload(id: string): boolean {
  const dl = _activeDownloads.get(id)
  if (!dl) return false
  dl.state = 'Cancelled'
  return true
}

function sanitize(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}
