import { resolveDownloadSettings } from '~/server/utils/downloadSettings'

// qBittorrent WebUI API (v2) client. Mirrors the slskd client pattern: a small cached session (here a
// SID cookie from /auth/login) + a typed fetch wrapper. Used to add torrents PAUSED (so we can inspect
// the file tree before downloading), selectively download only the folders we want, poll progress, and
// delete the torrent + its data the moment it's no longer needed.

interface QbitConfig {
  url: string
  user: string
  pass: string
}

let cookie: string | null = null
let cookieAt = 0
const COOKIE_TTL = 30 * 60_000 // qBit sessions last ~1h; refresh well before

// Category dmp's torrents are filed under, so they're isolated/identifiable (Lidarr-style).
export const QBIT_CATEGORY = 'dmp'

async function getQbitConfig(): Promise<QbitConfig | null> {
  const { qbittorrentUrl, qbittorrentUser, qbittorrentPass } = await resolveDownloadSettings()
  if (!qbittorrentUrl) return null
  return { url: qbittorrentUrl.replace(/\/$/, ''), user: qbittorrentUser, pass: qbittorrentPass }
}

async function login(config: QbitConfig): Promise<string> {
  const body = new URLSearchParams({ username: config.user, password: config.pass })
  const res = await fetch(`${config.url}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: config.url },
    body,
  })
  if (!res.ok) throw createError({ statusCode: res.status, message: `qBittorrent login failed: ${res.status}` })
  const text = await res.text().catch(() => '')
  if (text.trim() === 'Fails.') throw createError({ statusCode: 403, message: 'qBittorrent login rejected (bad credentials)' })
  const setCookie = res.headers.get('set-cookie') || ''
  const sid = /SID=([^;]+)/.exec(setCookie)?.[1]
  if (!sid) throw createError({ statusCode: 502, message: 'qBittorrent did not return a session cookie' })
  return `SID=${sid}`
}

async function getCookie(config: QbitConfig): Promise<string> {
  if (cookie && Date.now() - cookieAt < COOKIE_TTL) return cookie
  cookie = await login(config)
  cookieAt = Date.now()
  return cookie
}

export function clearQbitSession() {
  cookie = null
  cookieAt = 0
}

// Core request helper: attaches the session cookie, retries once on 403 (expired session).
async function qbitFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const config = await getQbitConfig()
  if (!config) throw createError({ statusCode: 503, message: 'qBittorrent not configured' })
  const sid = await getCookie(config)
  const res = await fetch(`${config.url}/api/v2${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> || {}), Cookie: sid, Referer: config.url },
  })
  if (res.status === 403 && retry) {
    clearQbitSession()
    return qbitFetch(path, init, false)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw createError({ statusCode: res.status, message: `qBittorrent API error: ${res.status} ${text}`.trim() })
  }
  return res
}

export async function checkQbittorrentConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = await getQbitConfig()
    if (!config) return { ok: false, error: 'qBittorrent URL not configured' }
    const res = await qbitFetch('/app/version')
    if (!res.ok) return { ok: false, error: `qBittorrent returned ${res.status}` }
    return { ok: true }
  }
  catch (e: any) {
    return { ok: false, error: e.message || 'Connection failed' }
  }
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

async function torrentsInfo(query: string): Promise<QbitTorrentInfo[]> {
  const res = await qbitFetch(`/torrents/info?${query}`)
  const data = (await res.json().catch(() => [])) as any[]
  if (!Array.isArray(data)) return []
  return data.map(t => ({
    hash: t.hash, name: t.name, state: t.state,
    progress: t.progress ?? 0, size: t.size ?? 0,
    completed: t.completed ?? 0, downloaded: t.downloaded ?? 0, tags: t.tags ?? '',
  }))
}

export async function getTorrentInfo(hashes: string[]): Promise<QbitTorrentInfo[]> {
  if (hashes.length === 0) return []
  return torrentsInfo(`hashes=${hashes.join('|')}`)
}

/**
 * Add a torrent (magnet or Prowlarr-proxied .torrent URL) in the STOPPED/paused state under the dmp
 * category + a unique tag, so qBittorrent fetches metadata but downloads nothing yet. Returns the
 * infohash once it appears (discovered via the unique tag — the add endpoint doesn't return it).
 */
export async function addTorrentPaused(urlOrMagnet: string, savePath: string, tag: string): Promise<string> {
  const form = new FormData()
  form.append('urls', urlOrMagnet)
  form.append('savepath', savePath)
  form.append('category', QBIT_CATEGORY)
  form.append('tags', tag)
  form.append('autoTMM', 'false')
  // qBit <5 uses `paused`, qBit 5 uses `stopped`; send both for compatibility.
  form.append('paused', 'true')
  form.append('stopped', 'true')
  await qbitFetch('/torrents/add', { method: 'POST', body: form })

  // Poll for the torrent to register under our unique tag, then read its hash.
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const found = await torrentsInfo(`tag=${encodeURIComponent(tag)}`)
    if (found[0]?.hash) return found[0].hash
  }
  throw createError({ statusCode: 504, message: 'qBittorrent did not register the torrent within 30s' })
}

export interface QbitFile {
  index: number
  name: string // path within the torrent
  size: number
  progress: number // 0..1
  priority: number
}

export async function getTorrentFiles(hash: string): Promise<QbitFile[]> {
  const res = await qbitFetch(`/torrents/files?hash=${hash}`)
  const data = (await res.json().catch(() => [])) as any[]
  if (!Array.isArray(data)) return []
  // Older qBit omits `index`; fall back to array position.
  return data.map((f, i) => ({
    index: f.index ?? i, name: f.name || '', size: f.size || 0,
    progress: f.progress ?? 0, priority: f.priority ?? 1,
  }))
}

// Set download priority for the given file indexes (0 = do not download, 1 = normal).
export async function setFilePriorities(hash: string, indexes: number[], priority: number): Promise<void> {
  if (indexes.length === 0) return
  const body = new URLSearchParams({ hash, id: indexes.join('|'), priority: String(priority) })
  await qbitFetch('/torrents/filePrio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
}

export async function startTorrent(hash: string): Promise<void> {
  // qBit <5: /torrents/resume ; qBit 5: /torrents/start. Try resume, fall back to start.
  const body = new URLSearchParams({ hashes: hash })
  try {
    await qbitFetch('/torrents/resume', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  }
  catch {
    await qbitFetch('/torrents/start', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ hashes: hash }) })
  }
}

// Remove the torrent and (by default) its data — called as soon as the torrent is no longer needed.
export async function deleteTorrent(hash: string, deleteFiles = true): Promise<void> {
  const body = new URLSearchParams({ hashes: hash, deleteFiles: String(deleteFiles) })
  await qbitFetch('/torrents/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => {})
}

// A torrent is "complete enough" for our selected files once qBit reports a finished state.
const QBIT_DONE_STATES = new Set([
  'uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'pausedUP', 'stoppedUP', 'checkingUP',
])
export function isQbitComplete(info: QbitTorrentInfo): boolean {
  return QBIT_DONE_STATES.has(info.state) || info.progress >= 1
}

export function isQbitErrored(info: QbitTorrentInfo): boolean {
  return info.state === 'error' || info.state === 'missingFiles'
}
