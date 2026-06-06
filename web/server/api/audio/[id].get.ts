import { createReadStream, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '~/server/utils/prisma'
import { getCachedSettings } from '~/server/utils/settingsCache'
import { requirePermission } from '~/server/utils/permissions'
import { buildEtag, mimeForFile, parseRangeHeader } from '~/server/utils/audioRange'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  const track = await prisma.localReleaseTrack.findUnique({
    where: { id },
    select: { filePath: true },
  })

  if (!track) throw createError({ statusCode: 404, statusMessage: 'Track not found' })

  const musicDir = getCachedSettings().musicDir
  if (!musicDir) throw createError({ statusCode: 500, statusMessage: 'MUSIC_DIR not configured' })

  const filePath = join(musicDir, track.filePath)

  let stat
  try {
    stat = statSync(filePath)
  }
  catch {
    const remoteServerUrl = useRuntimeConfig().remoteServerUrl
    if (remoteServerUrl) {
      return proxyRequest(event, `${remoteServerUrl}/api/audio/${id}`)
    }
    throw createError({ statusCode: 404, statusMessage: 'Audio file not found on disk' })
  }

  const fileSize = stat.size

  // ETag + Cache-Control: audio files are immutable at a given ID
  const etag = buildEtag(stat.size, stat.mtimeMs)
  setResponseHeader(event, 'ETag', etag)
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400, immutable')

  const ifNoneMatch = getRequestHeader(event, 'if-none-match')
  if (ifNoneMatch === etag) {
    setResponseStatus(event, 304)
    return ''
  }

  const contentType = mimeForFile(filePath)
  const range = parseRangeHeader(getRequestHeader(event, 'range'), fileSize)

  if (range) {
    const { start, end, chunkSize } = range
    setResponseStatus(event, 206)
    setResponseHeaders(event, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(chunkSize),
      'Content-Type': contentType,
    })

    return sendStream(event, createReadStream(filePath, { start, end }))
  }

  setResponseHeaders(event, {
    'Content-Length': String(fileSize),
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  })

  return sendStream(event, createReadStream(filePath))
})
