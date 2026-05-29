import { readdir, mkdir, rename, rmdir, copyFile, unlink } from 'node:fs/promises'
import { basename, join, dirname, sep } from 'node:path'
import { resolveDownloadSettings, resolveDownloadDir } from '~/server/utils/downloadSettings'

interface SlskdConfig {
  url: string
  apiKey: string
}

let configCache: (SlskdConfig & { cachedAt: number }) | null = null
const CACHE_TTL = 60_000

async function getSlskdConfig(): Promise<SlskdConfig | null> {
  if (configCache && Date.now() - configCache.cachedAt < CACHE_TTL) {
    return { url: configCache.url, apiKey: configCache.apiKey }
  }

  const { slskdUrl, slskdApiKey } = await resolveDownloadSettings()
  if (!slskdUrl || !slskdApiKey) return null

  configCache = { url: slskdUrl.replace(/\/$/, ''), apiKey: slskdApiKey, cachedAt: Date.now() }
  return { url: configCache.url, apiKey: configCache.apiKey }
}

export function clearSlskdConfigCache() {
  configCache = null
}

async function slskdFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const config = await getSlskdConfig()
  if (!config) throw createError({ statusCode: 503, message: 'slskd not configured' })

  const url = `${config.url}/api/v0${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': config.apiKey,
    ...(options.headers as Record<string, string> || {}),
  }

  const response = await fetch(url, { ...options, headers })
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => '')
    throw createError({
      statusCode: response.status,
      message: `slskd API error: ${response.status} ${text}`.trim(),
    })
  }
  return response
}

export async function checkSlskdConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = await getSlskdConfig()
    if (!config) return { ok: false, error: 'slskd URL or API key not configured' }

    const response = await slskdFetch('/server')
    if (!response.ok) return { ok: false, error: `slskd returned ${response.status}` }
    const data = await response.json().catch(() => null)
    if (data?.isLoggedIn === false) return { ok: false, error: 'slskd is not logged in to Soulseek' }
    return { ok: true }
  }
  catch (e: any) {
    return { ok: false, error: e.message || 'Connection failed' }
  }
}

export async function slskdSearch(query: string, timeout = 60000): Promise<string> {
  const response = await slskdFetch('/searches', {
    method: 'POST',
    body: JSON.stringify({
      searchText: query,
      timeout,
      filterResponses: true,
      minimumResponseFileCount: 1,
      minimumPeerUploadSpeed: 0,
    }),
  })

  const data = await response.json()
  return data.id
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

export async function getSlskdSearchResults(searchId: string): Promise<SlskdSearchResponse[]> {
  const response = await slskdFetch(`/searches/${searchId}/responses`)
  if (response.status === 404) return []
  return await response.json()
}

export async function deleteSlskdSearch(searchId: string): Promise<void> {
  await slskdFetch(`/searches/${searchId}`, { method: 'DELETE' }).catch(() => {})
}

export async function startSlskdDownload(
  username: string,
  files: { filename: string; size: number }[],
): Promise<void> {
  await slskdFetch(`/transfers/downloads/${encodeURIComponent(username)}`, {
    method: 'POST',
    body: JSON.stringify(files),
  })
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

export async function getSlskdActiveDownloads(): Promise<SlskdTransfer[]> {
  const response = await slskdFetch('/transfers/downloads')
  const data = await response.json()

  // slskd returns a nested structure: [{ username, directories: [{ files: [...] }] }]
  const transfers: SlskdTransfer[] = []
  for (const user of data) {
    for (const dir of user.directories || []) {
      for (const file of dir.files || []) {
        transfers.push({
          id: file.id || file.filename,
          username: user.username,
          filename: file.filename,
          size: file.size || 0,
          state: file.state || 'Unknown',
          bytesTransferred: file.bytesTransferred || 0,
          percentComplete: file.percentComplete || 0,
          averageSpeed: file.averageSpeed || 0,
        })
      }
    }
  }

  return transfers
}

export async function cancelSlskdDownload(username: string, id: string): Promise<void> {
  await slskdFetch(
    `/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=true`,
    { method: 'DELETE' },
  )
}

// slskd compound transfer states start with the overall phase, e.g.
// "Completed, Succeeded" / "Completed, Errored" / "Completed, Cancelled" / "Completed, TimedOut"
// / "Completed, Rejected". "Succeeded" is the only happy outcome.
export function isSlskdTerminal(state: string): boolean {
  return state.startsWith('Completed')
}

export function isSlskdSucceeded(state: string): boolean {
  return state.includes('Succeeded')
}

export function isSlskdFailed(state: string): boolean {
  return isSlskdTerminal(state) && !isSlskdSucceeded(state)
}

// Audio file extensions for filtering search results
const AUDIO_EXTENSIONS = new Set(['flac', 'mp3', 'ogg', 'aac', 'wma', 'opus', 'wav', 'ape', 'alac', 'm4a'])

export function isAudioFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return AUDIO_EXTENSIONS.has(ext)
}

export function detectFormat(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  if (ext === 'flac') return 'FLAC'
  if (ext === 'mp3') return 'MP3'
  if (ext === 'ogg' || ext === 'opus') return 'OGG'
  if (ext === 'aac' || ext === 'm4a') return 'AAC'
  return ext.toUpperCase()
}

export function scoreSlskdResult(
  format: string,
  avgBitrate: number,
  fileCount: number,
  uploadSpeed: number,
  queueLength: number,
  hasFreeSlot: boolean,
): number {
  // Format weight
  let score = 0
  if (format === 'FLAC') score = 100
  else if (format === 'MP3' && avgBitrate >= 320) score = 80
  else if (format === 'MP3' && avgBitrate >= 256) score = 60
  else if (format === 'MP3') score = 40
  else score = 20

  // File count bonus (more complete albums score higher)
  score += Math.min(fileCount * 2, 30)

  // Upload speed bonus (bytes/sec)
  if (uploadSpeed >= 5_000_000) score += 15
  else if (uploadSpeed >= 1_000_000) score += 10
  else if (uploadSpeed >= 500_000) score += 5

  // Queue length penalty
  if (queueLength > 50) score -= 25
  else if (queueLength > 20) score -= 15
  else if (queueLength > 10) score -= 10

  // Free slot bonus
  if (hasFreeSlot) score += 15
  else score -= 15

  return Math.max(0, score)
}

// --- Post-completion file move ---
//
// slskd writes downloaded files to its own configured downloads directory
// (typically mounted at DOWNLOADS_PATH when DMP and slskd share storage).
// After transfers complete we relocate the files into the templated
// Artist/Album folder so all three sources share one layout.

interface SlskdMoveArgs {
  username: string
  files: string[] // remote filenames as queued
  downloadsPath: string
  dirTemplate: string
  artistName: string
  albumTitle: string
  year: number | null
}

export async function moveSlskdFilesOnCompletion(args: SlskdMoveArgs): Promise<void> {
  const log = (msg: string) => console.log(`[slskd move] ${msg}`)
  const expected = new Set(args.files.map(f => basename(f.replace(/\\/g, '/'))))
  const deadline = Date.now() + 30 * 60 * 1000 // 30 minutes

  log(`scheduled: ${args.username} / ${args.artistName} / ${args.albumTitle} (${expected.size} files)`)

  // Wait for all transfers for this username+files to leave in-progress states.
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000))
    let transfers: SlskdTransfer[] = []
    try { transfers = await getSlskdActiveDownloads() }
    catch { continue }

    const ours = transfers.filter(t =>
      t.username === args.username && expected.has(basename(t.filename.replace(/\\/g, '/'))),
    )
    // If slskd no longer lists the transfer, consider it done.
    if (ours.length === 0) { log('transfers no longer listed - proceeding to move'); break }

    const stillActive = ours.some(t => !isSlskdTerminal(t.state))
    if (!stillActive) { log('all transfers reached terminal state - proceeding to move'); break }
  }

  // Small grace period for slskd to finalize file writes before we scan.
  await new Promise(r => setTimeout(r, 3000))

  const targetDir = join(
    args.downloadsPath,
    resolveDownloadDir(args.dirTemplate, args.artistName, args.albumTitle, args.year),
  )
  await mkdir(targetDir, { recursive: true })
  log(`target: ${targetDir}`)

  // Locate files under downloadsPath by basename and move them.
  const found = await findFilesByBasename(args.downloadsPath, expected, 10)
  log(`found ${found.length}/${expected.size} files under ${args.downloadsPath}`)
  if (found.length === 0) {
    log(`no files matched - slskd may be writing elsewhere or basenames changed. Expected: ${Array.from(expected).slice(0, 3).join(', ')}${expected.size > 3 ? '…' : ''}`)
    return
  }

  const movedFromDirs = new Set<string>()
  let movedCount = 0

  for (const srcPath of found) {
    const destPath = join(targetDir, basename(srcPath))
    if (srcPath === destPath) continue
    try {
      await rename(srcPath, destPath)
      movedFromDirs.add(dirname(srcPath))
      movedCount++
    }
    catch (e: any) {
      // SMB/drvfs mounts often refuse cross-directory rename. Fall back to copy+unlink.
      if (e?.code === 'EACCES' || e?.code === 'EXDEV' || e?.code === 'EPERM') {
        try {
          await copyFile(srcPath, destPath)
          await unlink(srcPath)
          movedFromDirs.add(dirname(srcPath))
          movedCount++
        }
        catch (e2: any) {
          log(`failed to copy+unlink ${srcPath} -> ${destPath}: ${e2.message}`)
        }
      }
      else {
        log(`failed to move ${srcPath} -> ${destPath}: ${e.message}`)
      }
    }
  }
  log(`moved ${movedCount} files to ${targetDir}`)

  // Best-effort cleanup of now-empty source directories (but never the root).
  for (const dir of movedFromDirs) {
    await removeEmptyDirsUp(dir, args.downloadsPath)
  }
}

async function findFilesByBasename(
  root: string,
  names: Set<string>,
  maxDepth: number,
): Promise<string[]> {
  const results: string[] = []
  const skipDirs = new Set<string>()
  // Skip walking into the root's top-level dirs that look like other artist folders we've written.
  // Instead, we just DFS everything under root up to maxDepth.

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return
    let entries: { name: string; isFile: boolean; isDir: boolean }[] = []
    try {
      const raw = await readdir(dir, { withFileTypes: true })
      entries = raw.map(e => ({ name: e.name, isFile: e.isFile(), isDir: e.isDirectory() }))
    }
    catch { return }

    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isFile && names.has(e.name)) {
        results.push(full)
      }
      else if (e.isDir && !skipDirs.has(full)) {
        await walk(full, depth + 1)
      }
    }
  }

  await walk(root, 0)
  return results
}

async function removeEmptyDirsUp(startDir: string, stopAt: string): Promise<void> {
  const normalizedStop = stopAt.replace(/[/\\]+$/, '')
  let current = startDir
  while (current && current !== normalizedStop && current.startsWith(normalizedStop + sep)) {
    let isEmpty = false
    try {
      const entries = await readdir(current)
      isEmpty = entries.length === 0
    }
    catch { return }
    if (!isEmpty) return
    try { await rmdir(current) }
    catch { return }
    current = dirname(current)
  }
}

