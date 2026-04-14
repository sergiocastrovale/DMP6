import { createHash, createDecipheriv } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { resolveDownloadSettings, resolveDownloadDir } from '~/server/utils/downloadSettings'

// Deezer API endpoints
const GW_API = 'https://www.deezer.com/ajax/gw-light.php'
const MEDIA_API = 'https://media.deezer.com/v1/get_url'

// Blowfish decryption secret (public knowledge, used by all Deezer clients)
const BF_SECRET = Buffer.from('g4el58wc0zvf9na1')
const BF_IV = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
const CHUNK_SIZE = 2048

// Quality format codes for the media API
const QUALITY_FORMATS: Record<string, { cipher: string; format: string }> = {
  flac: { cipher: 'BF_CBC_STRIPE', format: 'FLAC' },
  mp3_320: { cipher: 'BF_CBC_STRIPE', format: 'MP3_320' },
  mp3_128: { cipher: 'BF_CBC_STRIPE', format: 'MP3_128' },
}
const QUALITY_ORDER = ['flac', 'mp3_320', 'mp3_128'] as const

// Session state (singleton)
let _apiToken: string | null = null
let _licenseToken: string | null = null
let _authenticated = false
let _arl: string | null = null
let _lastRequest = 0
const MIN_INTERVAL = 500

// Active downloads tracking
const _activeDownloads = new Map<string, DeezerDownloadState>()

interface DeezerDownloadState {
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

function getBlowfishKey(trackId: string): Buffer {
  const md5Hex = createHash('md5').update(String(trackId)).digest('hex')
  const key = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) {
    key[i] = md5Hex.charCodeAt(i) ^ md5Hex.charCodeAt(i + 16) ^ BF_SECRET[i]!
  }
  return key
}

function decryptChunk(chunk: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('bf-cbc', key, BF_IV)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(chunk), decipher.final()])
}

async function rateLimit() {
  const elapsed = Date.now() - _lastRequest
  if (elapsed < MIN_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL - elapsed))
  }
  _lastRequest = Date.now()
}

async function gwCall(method: string, params: Record<string, any> = {}): Promise<any | null> {
  await rateLimit()

  const url = new URL(GW_API)
  url.searchParams.set('method', method)
  url.searchParams.set('api_version', '1.0')
  url.searchParams.set('api_token', _apiToken || 'null')

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': `arl=${_arl}`,
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) return null
    const data = await response.json()

    if (data.error) {
      const error = data.error
      const errorMsg = typeof error === 'object'
        ? (error.VALID_TOKEN_REQUIRED || error.GATEWAY_ERROR || JSON.stringify(error))
        : String(error)
      if (errorMsg) console.warn(`Deezer API error (${method}): ${errorMsg}`)
      return null
    }

    return data.results ?? {}
  }
  catch (e: any) {
    console.error(`Deezer API call failed (${method}): ${e.message}`)
    return null
  }
}

async function authenticate(arl: string): Promise<boolean> {
  _arl = arl
  _authenticated = false

  const resp = await gwCall('deezer.getUserData')
  if (!resp) return false

  const user = resp.USER ?? {}
  const userId = user.USER_ID ?? 0
  if (!userId || userId === 0) return false

  _apiToken = resp.checkForm ?? ''
  _licenseToken = user.OPTIONS?.license_token ?? ''
  _authenticated = true
  return true
}

async function getDeezerConfig(): Promise<string | null> {
  const { deezerArl } = await resolveDownloadSettings()
  return deezerArl || null
}

async function ensureAuthenticated(): Promise<boolean> {
  if (_authenticated) return true

  const arl = await getDeezerConfig()
  if (!arl) return false

  return authenticate(arl)
}

export async function checkDeezerConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const arl = await getDeezerConfig()
    if (!arl) return { ok: false, error: 'Deezer ARL not configured' }

    const ok = await authenticate(arl)
    if (!ok) return { ok: false, error: 'Invalid ARL token' }
    return { ok: true }
  }
  catch (e: any) {
    return { ok: false, error: e.message || 'Connection failed' }
  }
}

export interface DeezerSearchResult {
  id: string
  title: string
  artist: string
  album: string
  albumId: string
  duration: number // seconds
  cover: string
}

export interface DeezerAlbumResult {
  id: string
  title: string
  artist: string
  trackCount: number
  cover: string
  duration: number // total seconds
  tracks: DeezerSearchResult[]
}

export async function deezerSearchAlbum(query: string): Promise<DeezerAlbumResult[]> {
  if (!await ensureAuthenticated()) return []

  try {
    const response = await fetch(
      `https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=20`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': `arl=${_arl}`,
        },
      },
    )
    if (!response.ok) return []
    const data = await response.json()

    const albums: DeezerAlbumResult[] = []
    for (const item of data.data ?? []) {
      albums.push({
        id: String(item.id || ''),
        title: item.title || 'Unknown',
        artist: item.artist?.name || 'Unknown',
        trackCount: item.nb_tracks || 0,
        cover: item.cover_medium || '',
        duration: 0,
        tracks: [],
      })
    }

    return albums
  }
  catch (e: any) {
    console.error(`Deezer album search failed: ${e.message}`)
    return []
  }
}

export async function deezerGetAlbumTracks(albumId: string): Promise<DeezerSearchResult[]> {
  try {
    const response = await fetch(
      `https://api.deezer.com/album/${albumId}/tracks?limit=100`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': `arl=${_arl}`,
        },
      },
    )
    if (!response.ok) return []
    const data = await response.json()

    return (data.data ?? []).map((t: any) => ({
      id: String(t.id || ''),
      title: t.title || 'Unknown',
      artist: t.artist?.name || 'Unknown',
      album: '',
      albumId,
      duration: t.duration || 0,
      cover: '',
    }))
  }
  catch {
    return []
  }
}

async function getMediaUrl(trackToken: string, quality: string): Promise<string | null> {
  if (!_licenseToken) return null
  const fmt = QUALITY_FORMATS[quality]
  if (!fmt) return null

  try {
    const response = await fetch(MEDIA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_token: _licenseToken,
        media: [{ type: 'FULL', formats: [fmt] }],
        track_tokens: [trackToken],
      }),
    })

    if (!response.ok) return null
    const data = await response.json()

    const media = data.data?.[0]?.media?.[0]
    const sources = media?.sources
    return sources?.[0]?.url ?? null
  }
  catch {
    return null
  }
}

export async function startDeezerDownload(
  trackIds: string[],
  downloadsPath: string,
  albumTitle?: string,
  artistName?: string,
  year?: number | null,
  dirTemplate?: string,
): Promise<string> {
  if (!await ensureAuthenticated()) {
    throw createError({ statusCode: 503, message: 'Deezer not authenticated' })
  }

  const groupId = `deezer-${Date.now()}`

  // Create nested folder based on template
  const albumDir = artistName && albumTitle && dirTemplate
    ? join(downloadsPath, resolveDownloadDir(dirTemplate, artistName, albumTitle, year))
    : join(downloadsPath, `deezer-${Date.now()}`)
  mkdirSync(albumDir, { recursive: true })

  // Download each track in background
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

    // Fire and forget — download runs in background
    downloadTrack(dlId, trackId, albumDir).catch((e) => {
      const dl = _activeDownloads.get(dlId)
      if (dl) {
        dl.state = 'Errored'
        dl.error = e.message
      }
    })
  }

  return groupId
}

async function downloadTrack(dlId: string, trackId: string, albumDir: string) {
  const dl = _activeDownloads.get(dlId)
  if (!dl) return

  dl.state = 'Initializing'

  // Get track data from private API
  const trackData = await gwCall('song.getData', { sng_id: trackId })
  if (!trackData) {
    dl.state = 'Errored'
    dl.error = 'Failed to get track data'
    return
  }

  const trackToken = trackData.TRACK_TOKEN || ''
  const title = trackData.SNG_TITLE || `Track ${trackId}`
  const artist = trackData.ART_NAME || 'Unknown'
  const trackNum = trackData.TRACK_NUMBER || ''
  dl.displayName = `${artist} - ${title}`

  if (!trackToken) {
    dl.state = 'Errored'
    dl.error = 'No track token available'
    return
  }

  // Try quality levels with fallback
  let mediaUrl: string | null = null
  let actualQuality = ''
  for (const q of QUALITY_ORDER) {
    const url = await getMediaUrl(trackToken, q)
    if (url) {
      mediaUrl = url
      actualQuality = q
      break
    }
  }

  if (!mediaUrl) {
    dl.state = 'Errored'
    dl.error = 'No media URL available (may require higher subscription tier)'
    return
  }

  const ext = actualQuality === 'flac' ? '.flac' : '.mp3'
  const prefix = trackNum ? `${String(trackNum).padStart(2, '0')} ` : ''
  const safeTitle = sanitizeFilename(`${prefix}${artist} - ${title}`)
  const outPath = join(albumDir, `${safeTitle}${ext}`)

  dl.state = 'InProgress'

  // Stream download with Blowfish decryption
  const bfKey = getBlowfishKey(trackId)
  const response = await fetch(mediaUrl)
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
  let chunkIndex = 0
  let buffer = Buffer.alloc(0)
  const startTime = Date.now()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer = Buffer.concat([buffer, Buffer.from(value)])

      // Process complete chunks
      while (buffer.length >= CHUNK_SIZE) {
        const chunk = buffer.subarray(0, CHUNK_SIZE)
        buffer = buffer.subarray(CHUNK_SIZE)

        // Decrypt every 3rd chunk (Deezer's encryption pattern)
        const toWrite = (chunkIndex % 3 === 0 && chunk.length === CHUNK_SIZE)
          ? decryptChunk(chunk, bfKey)
          : chunk

        fileStream.write(toWrite)
        downloaded += chunk.length
        chunkIndex++

        // Update progress
        dl.transferred = downloaded
        if (totalSize > 0) dl.progress = (downloaded / totalSize) * 100
        const elapsed = (Date.now() - startTime) / 1000
        if (elapsed > 0) dl.speed = Math.round(downloaded / elapsed)
      }
    }

    // Write remaining buffer
    if (buffer.length > 0) {
      fileStream.write(buffer)
      downloaded += buffer.length
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end(() => resolve())
      fileStream.on('error', reject)
    })

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

export function getDeezerActiveDownloads(): DeezerDownloadState[] {
  return Array.from(_activeDownloads.values())
}

export function cancelDeezerDownload(id: string): boolean {
  const dl = _activeDownloads.get(id)
  if (!dl) return false
  dl.state = 'Cancelled'
  return true
}

export function clearCompletedDeezerDownloads() {
  for (const [id, dl] of _activeDownloads) {
    if (dl.state === 'Completed' || dl.state === 'Cancelled' || dl.state === 'Errored') {
      _activeDownloads.delete(id)
    }
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}
