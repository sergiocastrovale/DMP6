import { readdir, mkdir, rename, rmdir, copyFile, unlink, stat } from 'node:fs/promises'
import { basename, join, dirname, sep, extname } from 'node:path'
import { resolveDownloadSettings, resolveDownloadDir } from '~/server/utils/downloadSettings'
import { transcodeDirToMp3320 } from '~/server/utils/transcode'
import { monitorLog } from '~/server/utils/monitorLog'

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
  files: { filename: string; size: number }[] // remote filenames + sizes as queued
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
}

export async function moveSlskdFilesOnCompletion(args: SlskdMoveArgs): Promise<SlskdMoveResult> {
  const log = (msg: string) => monitorLog('notice', `slskd move: ${msg}`)
  const expected = new Set(args.files.map(f => basename(f.filename.replace(/\\/g, '/'))))
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

  return relocateDownloadedFiles(args)
}

/**
 * Move this download's files (located by basename+size under downloadsPath) into the templated
 * Artist/Album folder and normalize to MP3-320. Assumes the transfer is already finished —
 * does NOT wait. Used by the reconciler, which gates on slskd transfer state itself.
 */
export async function relocateDownloadedFiles(args: SlskdMoveArgs): Promise<SlskdMoveResult> {
  const log = (msg: string) => monitorLog('notice', `slskd move: ${msg}`)
  // slskd writes all downloads flat under one shared root (no per-transfer subfolder to scope a scan
  // to — see docs/downloads_slskd.md), so two concurrent downloads can share a same-named track. Match
  // on basename AND exact byte size (from the queued search result) to avoid one download's finalize
  // capturing a same-named file that belongs to a different, still-in-flight download.
  const expected = new Map<string, number>()
  for (const f of args.files) expected.set(basename(f.filename.replace(/\\/g, '/')), f.size)

  const targetDir = join(
    args.downloadsPath,
    resolveDownloadDir(args.dirTemplate, args.artistName, args.albumTitle, args.year),
  )
  await mkdir(targetDir, { recursive: true })

  // Locate files by basename+size (under scanRoot when given, else the downloads root) and move them.
  const scanRoot = args.scanRoot || args.downloadsPath
  const found = await findFilesByBasename(scanRoot, expected, 10)
  log(`found ${found.length}/${expected.size} files under ${scanRoot} -> ${targetDir}`)
  if (found.length === 0) {
    return { targetDir, movedCount: 0 }
  }

  const movedFromDirs = new Set<string>()
  let movedCount = 0

  for (const srcPath of found) {
    const destPath = join(targetDir, stripSlskdSuffix(basename(srcPath)))
    if (srcPath === destPath) { movedCount++; continue } // already in place
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
          // The copy is what matters: the file is now in the target. slskd writes sources as its own
          // uid, so unlink can fail (EACCES) — count it moved anyway and leave the orphan source for
          // the periodic prune sweep. Failing here would wrongly mark the whole release as failed.
          await unlink(srcPath).then(() => movedFromDirs.add(dirname(srcPath)),
            (e3: any) => monitorLog('warn', `slskd move: copied but could not remove source ${srcPath}: ${e3.message}`))
          movedCount++
        }
        catch (e2: any) {
          monitorLog('warn', `slskd move: failed to copy ${srcPath} -> ${destPath}: ${e2.message}`)
        }
      }
      else {
        monitorLog('warn', `slskd move: failed to move ${srcPath} -> ${destPath}: ${e.message}`)
      }
    }
  }
  log(`moved ${movedCount} files to ${targetDir}`)

  // Best-effort cleanup of now-empty source directories (but never the root).
  for (const dir of movedFromDirs) {
    await removeEmptyDirsUp(dir, args.downloadsPath)
  }

  // Normalize everything in the target folder to MP3-320 (keeps existing mp3s as-is).
  await transcodeDirToMp3320(targetDir).catch(e => monitorLog('warn', `slskd move: transcode failed: ${e.message}`))

  return { targetDir, movedCount }
}

/**
 * slskd appends a collision token `_<18-or-more digits>` before the extension when a same-named
 * file already exists in its download dir (e.g. `01. Stone_639171186044183498.flac`). Strip it so
 * basename matching and the final library filename stay clean.
 */
export const stripSlskdSuffix = (name: string): string => {
  const e = extname(name)
  return name.slice(0, name.length - e.length).replace(/_\d{6,}$/, '') + e
}

// `names` maps a suffix-stripped basename to its expected byte size. When a size is known (> 0), a
// same-named file on disk must match it exactly to count as a hit — this is the only signal available
// to tell apart two concurrent downloads that happen to share a track filename, since slskd writes
// every transfer flat under one shared root with no per-transfer subfolder (see
// docs/downloads_slskd.md). A size of 0/unknown falls back to name-only matching (legacy rows / sizes
// slskd didn't report).
async function findFilesByBasename(
  root: string,
  names: Map<string, number>,
  maxDepth: number,
): Promise<string[]> {
  const results: string[] = []
  // Match on the suffix-stripped basename so slskd collision tokens don't defeat the lookup.
  const wanted = new Map([...names].map(([name, size]) => [stripSlskdSuffix(name), size]))
  // Internal subtrees under the downloads root that must never be scanned as slsk transfer sources:
  // the ready/merge staging area, the SongKong spool/state dir, and qBittorrent's torrent data
  // (torrent relocation passes the specific album folder as scanRoot, so this skip only affects slsk).
  const skipNames = new Set(['_ready', '.dmp-songkong', '_torrents'])

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
      if (e.isFile && wanted.has(stripSlskdSuffix(e.name))) {
        const expectedSize = wanted.get(stripSlskdSuffix(e.name))!
        if (expectedSize > 0) {
          const actualSize = await stat(full).then(s => s.size).catch(() => -1)
          if (actualSize !== expectedSize) continue // same name, wrong file — belongs to another transfer
        }
        results.push(full)
      }
      else if (e.isDir && !skipNames.has(e.name)) {
        await walk(full, depth + 1)
      }
    }
  }

  await walk(root, 0)
  return results
}

/**
 * Delete this download's source files (located by basename+size under downloadsPath) and prune the
 * now-empty directories they sat in. Called when a download is given up on: in dmp's no-resume
 * model those bytes can never be reused and only clutter the downloads root.
 */
export async function purgeDownloadedSourceFiles(downloadsPath: string, files: { filename: string; size: number }[]): Promise<number> {
  const expected = new Map<string, number>()
  for (const f of files) expected.set(basename(f.filename.replace(/\\/g, '/')), f.size)
  if (expected.size === 0) { return 0 }

  const found = await findFilesByBasename(downloadsPath, expected, 10)
  const fromDirs = new Set<string>()
  let removed = 0
  for (const srcPath of found) {
    try {
      await unlink(srcPath)
      fromDirs.add(dirname(srcPath))
      removed++
    }
    catch (e: any) {
      monitorLog('warn', `slskd purge: failed to delete ${srcPath}: ${e.message}`)
    }
  }
  for (const dir of fromDirs) {
    await removeEmptyDirsUp(dir, downloadsPath)
  }
  if (removed > 0) { monitorLog('notice', `slskd purge: deleted ${removed} source file(s) under ${downloadsPath}`) }
  return removed
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

