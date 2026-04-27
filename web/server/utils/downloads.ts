import type { DownloadSource, ActiveDownload, DownloadStatus, SearchResult, SearchResultFile } from '~/types/download'
import {
  checkSlskdConnection,
  slskdSearch,
  getSlskdSearchResults,
  deleteSlskdSearch,
  startSlskdDownload,
  getSlskdActiveDownloads,
  cancelSlskdDownload,
  isAudioFile,
  detectFormat,
  scoreSlskdResult,
} from '~/server/utils/slskd'
import {
  checkDeezerConnection,
  deezerSearchAlbum,
  deezerGetAlbumTracks,
  startDeezerDownload,
  getDeezerActiveDownloads,
  cancelDeezerDownload,
} from '~/server/utils/deezer'
import {
  checkHifiConnection,
  hifiSearchAlbum,
  startHifiDownload,
  getHifiActiveDownloads,
  cancelHifiDownload,
} from '~/server/utils/hifi'

export async function getDownloadStatus(): Promise<DownloadStatus> {
  const [slskd, deezer, hifi] = await Promise.all([
    checkSlskdConnection().catch(() => ({ ok: false, error: 'Connection failed' })),
    checkDeezerConnection().catch(() => ({ ok: false, error: 'Connection failed' })),
    checkHifiConnection().catch(() => ({ ok: false, error: 'Connection failed' })),
  ])

  return {
    slskd: { configured: slskd.ok || !slskd.error?.includes('not configured'), connected: slskd.ok, error: slskd.error },
    deezer: { configured: deezer.ok || !deezer.error?.includes('not configured'), connected: deezer.ok, error: deezer.error },
    hifi: { configured: true, connected: hifi.ok, error: hifi.error },
  }
}

// --- Search ---

export async function searchSlskd(query: string, timeout?: number): Promise<string> {
  return slskdSearch(query, timeout)
}

export async function getSlskdResults(searchId: string, allowedFormats?: string, minBitrate?: number): Promise<SearchResult[]> {
  const responses = await getSlskdSearchResults(searchId)
  const results: SearchResult[] = []

  const formatSet = allowedFormats
    ? new Set(allowedFormats.split(',').map(f => f.trim().toLowerCase()))
    : null

  for (const resp of responses) {
    // Filter to audio files
    const audioFiles = (resp.files || []).filter(f => isAudioFile(f.filename))
    if (audioFiles.length === 0) continue

    // Group by directory
    const groups = new Map<string, typeof audioFiles>()
    for (const file of audioFiles) {
      const parts = file.filename.replace(/\\/g, '/').split('/')
      const dir = parts.slice(0, -1).join('/')
      const existing = groups.get(dir) || []
      existing.push(file)
      groups.set(dir, existing)
    }

    for (const [dir, files] of groups) {
      // Detect dominant format
      const formatCounts = new Map<string, number>()
      let totalBitrate = 0
      let bitrateCount = 0

      for (const f of files) {
        const fmt = detectFormat(f.filename)
        formatCounts.set(fmt, (formatCounts.get(fmt) || 0) + 1)
        if (f.bitRate) {
          totalBitrate += f.bitRate
          bitrateCount++
        }
      }

      let dominantFormat = 'Unknown'
      let maxCount = 0
      for (const [fmt, count] of formatCounts) {
        if (count > maxCount) {
          dominantFormat = fmt
          maxCount = count
        }
      }

      const avgBitrate = bitrateCount > 0 ? Math.round(totalBitrate / bitrateCount) : 0

      // Apply filters
      if (formatSet && !formatSet.has(dominantFormat.toLowerCase())) continue
      if (minBitrate && avgBitrate > 0 && avgBitrate < minBitrate) continue

      const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0)
      const hasFreeSlot = resp.freeUploadSlots > 0
      const score = scoreSlskdResult(
        dominantFormat, avgBitrate, files.length,
        resp.uploadSpeed, resp.queueLength, hasFreeSlot,
      )

      results.push({
        id: `${resp.username}:${dir}`,
        source: 'slskd',
        username: resp.username,
        folderPath: dir,
        files: files.map(f => ({
          filename: f.filename,
          size: f.size,
          bitRate: f.bitRate,
          duration: f.length ? f.length * 1000 : undefined,
        })),
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

  // Sort by upload speed descending (free slots first as tiebreaker)
  results.sort((a, b) => {
    if (a.hasFreeSlot !== b.hasFreeSlot) return a.hasFreeSlot ? -1 : 1
    return (b.uploadSpeed || 0) - (a.uploadSpeed || 0)
  })
  return results
}

export async function searchDeezer(query: string): Promise<SearchResult[]> {
  const albums = await deezerSearchAlbum(query)
  const results: SearchResult[] = []

  for (const album of albums) {
    results.push({
      id: `deezer:${album.id}`,
      source: 'deezer',
      username: 'deezer',
      folderPath: `${album.artist} - ${album.title}`,
      files: [],
      fileCount: album.trackCount,
      totalSize: 0,
      format: 'FLAC/MP3',
      avgBitrate: 0,
      score: 80 + Math.min(album.trackCount * 2, 20), // Deezer results get a high base score
      hasFreeSlot: true,
      queueLength: 0,
      uploadSpeed: 0,
    })
  }

  return results
}

export async function searchHifi(query: string, artist?: string): Promise<SearchResult[]> {
  const tracks = await hifiSearchAlbum(query, artist)
  if (tracks.length === 0) return []

  // Group tracks by album
  const albumMap = new Map<string, typeof tracks>()
  for (const t of tracks) {
    const key = t.album || 'Unknown'
    const existing = albumMap.get(key) || []
    existing.push(t)
    albumMap.set(key, existing)
  }

  const results: SearchResult[] = []
  for (const [album, albumTracks] of albumMap) {
    results.push({
      id: `hifi:${albumTracks[0]!.id}`,
      source: 'hifi',
      username: 'hifi',
      folderPath: `${albumTracks[0]!.artist} - ${album}`,
      files: albumTracks.map(t => ({
        filename: `${t.id}||${t.artist} - ${t.title}`,
        size: 0,
        duration: t.duration * 1000,
      })),
      fileCount: albumTracks.length,
      totalSize: 0,
      format: 'FLAC',
      avgBitrate: 1411,
      score: 95 + Math.min(albumTracks.length * 2, 10), // HiFi gets high score — lossless + reliable
    })
  }

  return results
}

// --- Downloads ---

export async function startDownload(
  source: DownloadSource,
  params: {
    username?: string
    files?: { filename: string; size: number }[]
    deezerAlbumId?: string
    albumTitle?: string
    artistName?: string
    year?: number | null
  },
  downloadsPath: string,
  dirTemplate: string,
): Promise<{ success: boolean; groupId?: string }> {
  if (source === 'slskd') {
    if (!params.username || !params.files?.length) {
      throw createError({ statusCode: 400, message: 'username and files required for slskd' })
    }
    await startSlskdDownload(params.username, params.files)
    // Schedule post-completion move into the templated folder (fire and forget).
    if (params.artistName && params.albumTitle) {
      moveSlskdFilesOnCompletion({
        username: params.username,
        files: params.files.map(f => f.filename),
        downloadsPath,
        dirTemplate,
        artistName: params.artistName,
        albumTitle: params.albumTitle,
        year: params.year ?? null,
      }).catch(e => console.error('[slskd move]', e.message))
    }
    return { success: true }
  }

  if (source === 'deezer') {
    if (!params.deezerAlbumId) {
      throw createError({ statusCode: 400, message: 'deezerAlbumId required for Deezer' })
    }
    const tracks = await deezerGetAlbumTracks(params.deezerAlbumId)
    if (tracks.length === 0) {
      throw createError({ statusCode: 404, message: 'No tracks found for this album' })
    }
    const trackIds = tracks.map(t => t.id)
    const groupId = await startDeezerDownload(
      trackIds, downloadsPath, params.albumTitle, params.artistName, params.year, dirTemplate,
    )
    return { success: true, groupId }
  }

  if (source === 'hifi') {
    if (!params.files?.length) {
      throw createError({ statusCode: 400, message: 'files (with track IDs) required for HiFi' })
    }
    const trackIds = params.files.map(f => f.filename.split('||')[0]!)
    const groupId = await startHifiDownload(
      trackIds, downloadsPath, params.albumTitle, params.artistName, params.year, dirTemplate,
    )
    return { success: true, groupId }
  }

  throw createError({ statusCode: 400, message: `Unknown source: ${source}` })
}

export async function getAllActiveDownloads(): Promise<ActiveDownload[]> {
  const [slskdTransfers, deezerDls, hifiDls] = await Promise.all([
    getSlskdActiveDownloads().catch(() => []),
    Promise.resolve(getDeezerActiveDownloads()),
    Promise.resolve(getHifiActiveDownloads()),
  ])

  const downloads: ActiveDownload[] = []

  for (const t of slskdTransfers) {
    downloads.push({
      id: t.id,
      source: 'slskd',
      username: t.username,
      filename: t.filename,
      size: t.size,
      bytesTransferred: t.bytesTransferred,
      percentComplete: t.percentComplete,
      state: t.state,
      averageSpeed: t.averageSpeed,
    })
  }

  for (const d of deezerDls) {
    downloads.push({
      id: d.id,
      source: 'deezer',
      username: 'deezer',
      filename: d.displayName,
      size: d.size,
      bytesTransferred: d.transferred,
      percentComplete: d.progress,
      state: d.state,
      averageSpeed: d.speed,
    })
  }

  for (const h of hifiDls) {
    downloads.push({
      id: h.id,
      source: 'hifi',
      username: 'hifi',
      filename: h.displayName,
      size: h.size,
      bytesTransferred: h.transferred,
      percentComplete: h.progress,
      state: h.state,
      averageSpeed: h.speed,
    })
  }

  return downloads
}

export async function cancelDownloadBySource(
  source: DownloadSource,
  username: string,
  id: string,
): Promise<void> {
  if (source === 'slskd') {
    await cancelSlskdDownload(username, id)
  }
  else if (source === 'deezer') {
    cancelDeezerDownload(id)
  }
  else if (source === 'hifi') {
    cancelHifiDownload(id)
  }
}
