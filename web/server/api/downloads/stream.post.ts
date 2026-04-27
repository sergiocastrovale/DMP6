import type { DownloadSource } from '~/types/download'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import {
  slskdSearch,
  getSlskdSearchResults,
  startSlskdDownload,
  getSlskdActiveDownloads,
  deleteSlskdSearch,
  isAudioFile,
  detectFormat,
  scoreSlskdResult,
  moveSlskdFilesOnCompletion,
  isSlskdTerminal,
  isSlskdSucceeded,
  isSlskdFailed,
} from '~/server/utils/slskd'
import {
  deezerSearchAlbum,
  deezerGetAlbumTracks,
  startDeezerDownload,
  getDeezerActiveDownloads,
} from '~/server/utils/deezer'
import {
  hifiSearchAlbum,
  startHifiDownload,
  getHifiActiveDownloads,
} from '~/server/utils/hifi'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { source, query, albumTitle, artistName, year } = body as {
    source: DownloadSource
    query: string
    albumTitle?: string
    artistName?: string
    year?: number | null
  }

  if (!source || !query) {
    throw createError({ statusCode: 400, message: 'source and query are required' })
  }

  const settings = await resolveDownloadSettings()
  const downloadsPath = settings.downloadsPath
  if (!downloadsPath) {
    throw createError({ statusCode: 503, message: 'DOWNLOADS_PATH not configured' })
  }

  const dirTemplate = settings.downloadDirTemplate
  const allowedFormats = settings.downloadFormats || undefined
  const minBitrate = settings.downloadMinBitrate ?? undefined

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const res = event.node.res

  const send = (text: string) => {
    res.write(`data: ${JSON.stringify(text)}\n\n`)
  }

  let aborted = false
  event.node.req.on('close', () => { aborted = true })

  return new Promise<void>(async (resolve) => {
    try {
      if (source === 'slskd') {
        await streamSlskdDownload(send, query, albumTitle, artistName, year, allowedFormats, minBitrate, downloadsPath, dirTemplate, () => aborted)
      }
      else if (source === 'deezer') {
        await streamDeezerDownload(send, query, albumTitle, artistName, year, downloadsPath, dirTemplate, () => aborted)
      }
      else if (source === 'hifi') {
        await streamHifiDownload(send, query, albumTitle, artistName, year, downloadsPath, dirTemplate, () => aborted)
      }
      else {
        send(`Error: Unknown source "${source}"`)
      }
    }
    catch (e: any) {
      send(`Error: ${e.message}`)
    }
    finally {
      res.write(`event: done\ndata: 0\n\n`)
      res.end()
      resolve()
    }
  })
})

async function streamSlskdDownload(
  send: (text: string) => void,
  query: string,
  albumTitle: string | undefined,
  artistName: string | undefined,
  year: number | null | undefined,
  allowedFormats: string | undefined,
  minBitrate: number | undefined,
  downloadsPath: string,
  dirTemplate: string,
  isAborted: () => boolean,
) {
  send(`Searching Soulseek for "${query}"...`)

  const searchId = await slskdSearch(query)
  send(`Search started (ID: ${searchId.slice(0, 8)}...)`)

  // Poll for results
  let bestResult: any = null
  let pollCount = 0
  const maxPolls = 15

  while (pollCount < maxPolls && !isAborted()) {
    await sleep(2000)
    pollCount++

    const responses = await getSlskdSearchResults(searchId)
    if (responses.length === 0) {
      send(`  Polling... (${pollCount}/${maxPolls}) — no responses yet`)
      continue
    }

    // Process results
    const results = processSlskdResponses(responses, allowedFormats, minBitrate)
    send(`  Polling... (${pollCount}/${maxPolls}) — ${results.length} results from ${responses.length} peers`)

    if (results.length > 0) {
      bestResult = results[0]
      // Early termination if we have a good FLAC result
      if (bestResult.format === 'FLAC' && bestResult.score >= 100) {
        send(`  Found high-quality FLAC result, stopping search early`)
        break
      }
      // Stop after enough polls with results
      if (pollCount >= 5 && results.length >= 3) break
    }
  }

  // Clean up search
  deleteSlskdSearch(searchId).catch(() => {})

  if (!bestResult) {
    send(`No suitable results found for "${query}"`)
    return
  }

  send('')
  send(`Best result: ${bestResult.folderPath}`)
  send(`  Format: ${bestResult.format} | Files: ${bestResult.fileCount} | Size: ${formatSize(bestResult.totalSize)}`)
  send(`  Peer: ${bestResult.username} | Score: ${bestResult.score}`)
  send('')
  send(`Starting download from ${bestResult.username}...`)

  await startSlskdDownload(bestResult.username, bestResult.files.map((f: any) => ({
    filename: f.filename,
    size: f.size,
  })))

  send(`Download queued — ${bestResult.fileCount} files`)

  // Schedule post-completion move into the templated folder.
  console.log(`[slskd move] gate: artistName=${JSON.stringify(artistName)} albumTitle=${JSON.stringify(albumTitle)} year=${JSON.stringify(year)} downloadsPath=${downloadsPath} dirTemplate=${JSON.stringify(dirTemplate)}`)
  if (artistName && albumTitle) {
    moveSlskdFilesOnCompletion({
      username: bestResult.username,
      files: bestResult.files.map((f: any) => f.filename),
      downloadsPath,
      dirTemplate,
      artistName,
      albumTitle,
      year: year ?? null,
    }).catch(e => {
      console.error(`[slskd move] scheduler rejected: ${e?.message || e}`)
    })
  }
  else {
    console.log(`[slskd move] SKIPPED — missing artistName or albumTitle`)
  }

  // Monitor progress
  let completed = false
  let monitorCount = 0
  const maxMonitor = 300 // 5 minutes max monitoring
  let lastProgressLine = ''
  let lastErroredCount = 0

  while (!completed && monitorCount < maxMonitor && !isAborted()) {
    await sleep(3000)
    monitorCount++

    const transfers = await getSlskdActiveDownloads()
    const relevant = transfers.filter(t => t.username === bestResult.username)

    if (relevant.length === 0 && monitorCount > 3) {
      send(`  Downloads no longer visible in slskd — may have completed`)
      break
    }

    const inProgress = relevant.filter(t => !isSlskdTerminal(t.state))
    const succeeded = relevant.filter(t => isSlskdSucceeded(t.state))
    const failed = relevant.filter(t => isSlskdFailed(t.state))

    if (inProgress.length > 0) {
      const totalProgress = relevant.reduce((sum, t) => {
        if (isSlskdSucceeded(t.state)) return sum + 100
        if (isSlskdFailed(t.state)) return sum
        return sum + (t.percentComplete || 0)
      }, 0) / relevant.length
      const line = `  Progress: ${succeeded.length}/${relevant.length} files complete (${Math.round(totalProgress)}%)`
      if (line !== lastProgressLine) {
        send(line)
        lastProgressLine = line
      }
    }

    if (failed.length > lastErroredCount) {
      send(`  ${failed.length} file(s) failed (${failed[0]?.state || 'unknown'})`)
      lastErroredCount = failed.length
    }

    if (inProgress.length === 0 && relevant.length > 0) {
      completed = true
      send('')
      if (failed.length > 0) {
        send(`Download finished — ${succeeded.length}/${relevant.length} succeeded, ${failed.length} failed`)
      }
      else {
        send(`Download complete — ${succeeded.length} files`)
      }
      send(`${albumTitle || bestResult.folderPath.split('/').pop() || query} downloaded to ${downloadsPath}.`)
    }
  }

  if (!completed && monitorCount >= maxMonitor) {
    send(`  Stopped monitoring (timeout). Download may still be in progress in slskd.`)
  }
}

async function streamDeezerDownload(
  send: (text: string) => void,
  query: string,
  albumTitle: string | undefined,
  artistName: string | undefined,
  year: number | null | undefined,
  downloadsPath: string,
  dirTemplate: string,
  isAborted: () => boolean,
) {
  send(`Searching Deezer for "${query}"...`)

  const albums = await deezerSearchAlbum(query)
  if (albums.length === 0) {
    send(`No albums found on Deezer for "${query}"`)
    return
  }

  send(`Found ${albums.length} album(s)`)

  // Pick best match (first result, Deezer sorts by relevance)
  const album = albums[0]!
  send(`  Selected: ${album.artist} — ${album.title} (${album.trackCount} tracks)`)
  send('')

  // Get tracks
  send(`Fetching track list...`)
  const tracks = await deezerGetAlbumTracks(album.id)
  if (tracks.length === 0) {
    send(`No tracks found for album`)
    return
  }

  send(`Found ${tracks.length} tracks`)
  for (const track of tracks) {
    send(`  ${track.title}`)
  }
  send('')

  send(`Starting Deezer download...`)
  const trackIds = tracks.map(t => t.id)
  const groupId = await startDeezerDownload(
    trackIds,
    downloadsPath,
    albumTitle || album.title,
    artistName || album.artist,
    year ?? null,
    dirTemplate,
  )

  // Monitor progress
  let completed = false
  let monitorCount = 0
  const maxMonitor = 200

  while (!completed && monitorCount < maxMonitor && !isAborted()) {
    await sleep(2000)
    monitorCount++

    const dls = getDeezerActiveDownloads()
    const relevant = dls.filter(d => d.id.startsWith(groupId))

    if (relevant.length === 0 && monitorCount > 3) break

    const inProgress = relevant.filter(d => d.state !== 'Completed' && d.state !== 'Errored' && d.state !== 'Cancelled')
    const done = relevant.filter(d => d.state === 'Completed')
    const errored = relevant.filter(d => d.state === 'Errored')

    if (inProgress.length > 0) {
      const current = inProgress[0]!
      send(`  Downloading: ${current.displayName} (${Math.round(current.progress)}%)`)
    }

    if (errored.length > 0) {
      for (const e of errored) {
        send(`  Error: ${e.displayName} — ${e.error || 'unknown error'}`)
      }
    }

    if (inProgress.length === 0 && relevant.length > 0) {
      completed = true
      send('')
      send(`Download complete — ${done.length}/${relevant.length} files`)
      if (errored.length > 0) send(`  ${errored.length} file(s) failed`)
      send(`${albumTitle || album!.title} downloaded to ${downloadsPath}.`)
    }
  }
}

function processSlskdResponses(
  responses: any[],
  allowedFormats?: string,
  minBitrate?: number,
): any[] {
  const formatSet = allowedFormats
    ? new Set(allowedFormats.split(',').map((f: string) => f.trim().toLowerCase()))
    : null

  const results: any[] = []

  for (const resp of responses) {
    const audioFiles = (resp.files || []).filter((f: any) => isAudioFile(f.filename))
    if (audioFiles.length === 0) continue

    const groups = new Map<string, any[]>()
    for (const file of audioFiles) {
      const parts = file.filename.replace(/\\/g, '/').split('/')
      const dir = parts.slice(0, -1).join('/')
      const existing = groups.get(dir) || []
      existing.push(file)
      groups.set(dir, existing)
    }

    for (const [dir, files] of groups) {
      const formatCounts = new Map<string, number>()
      let totalBitrate = 0
      let bitrateCount = 0

      for (const f of files) {
        const fmt = detectFormat(f.filename)
        formatCounts.set(fmt, (formatCounts.get(fmt) || 0) + 1)
        if (f.bitRate) { totalBitrate += f.bitRate; bitrateCount++ }
      }

      let dominantFormat = 'Unknown'
      let maxCount = 0
      for (const [fmt, count] of formatCounts) {
        if (count > maxCount) { dominantFormat = fmt; maxCount = count }
      }

      const avgBitrate = bitrateCount > 0 ? Math.round(totalBitrate / bitrateCount) : 0
      if (formatSet && !formatSet.has(dominantFormat.toLowerCase())) continue
      if (minBitrate && avgBitrate > 0 && avgBitrate < minBitrate) continue

      const totalSize = files.reduce((sum: number, f: any) => sum + (f.size || 0), 0)
      const hasFreeSlot = resp.freeUploadSlots > 0
      const score = scoreSlskdResult(dominantFormat, avgBitrate, files.length, resp.uploadSpeed, resp.queueLength, hasFreeSlot)

      results.push({
        username: resp.username,
        folderPath: dir,
        files: files.map((f: any) => ({ filename: f.filename, size: f.size })),
        fileCount: files.length,
        totalSize,
        format: dominantFormat,
        avgBitrate,
        score,
        hasFreeSlot,
        queueLength: resp.queueLength,
        uploadSpeed: resp.uploadSpeed,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results
}

async function streamHifiDownload(
  send: (text: string) => void,
  query: string,
  albumTitle: string | undefined,
  artistName: string | undefined,
  year: number | null | undefined,
  downloadsPath: string,
  dirTemplate: string,
  isAborted: () => boolean,
) {
  send(`Searching HiFi API for "${query}"...`)
  send(`  (Free lossless — no account required)`)

  const tracks = await hifiSearchAlbum(query, artistName)
  if (tracks.length === 0) {
    send(`No results found on HiFi API for "${query}"`)
    return
  }

  send(`Found ${tracks.length} track(s)`)
  for (const t of tracks) {
    send(`  ${t.artist} — ${t.title}`)
  }
  send('')

  send(`Starting HiFi download (FLAC)...`)
  const trackIds = tracks.map(t => t.id)
  const groupId = await startHifiDownload(
    trackIds,
    downloadsPath,
    albumTitle || tracks[0]!.album,
    artistName || tracks[0]!.artist,
    year ?? null,
    dirTemplate,
  )

  // Monitor progress
  let completed = false
  let monitorCount = 0
  const maxMonitor = 200

  while (!completed && monitorCount < maxMonitor && !isAborted()) {
    await sleep(2000)
    monitorCount++

    const dls = getHifiActiveDownloads()
    const relevant = dls.filter(d => d.id.startsWith(groupId))

    if (relevant.length === 0 && monitorCount > 3) break

    const inProgress = relevant.filter(d => d.state !== 'Completed' && d.state !== 'Errored' && d.state !== 'Cancelled')
    const done = relevant.filter(d => d.state === 'Completed')
    const errored = relevant.filter(d => d.state === 'Errored')

    if (inProgress.length > 0) {
      const current = inProgress[0]!
      send(`  Downloading: ${current.displayName} (${Math.round(current.progress)}%)`)
    }

    if (errored.length > 0) {
      for (const e of errored) {
        send(`  Error: ${e.displayName} — ${e.error || 'unknown error'}`)
      }
    }

    if (inProgress.length === 0 && relevant.length > 0) {
      completed = true
      send('')
      send(`Download complete — ${done.length}/${relevant.length} files`)
      if (errored.length > 0) send(`  ${errored.length} file(s) failed`)
      send(`${albumTitle || tracks[0]?.album || query} downloaded to ${downloadsPath}.`)
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}
