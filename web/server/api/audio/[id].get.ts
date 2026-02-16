import { createReadStream, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  const track = await prisma.localReleaseTrack.findUnique({
    where: { id },
    select: { filePath: true },
  })

  if (!track) throw createError({ statusCode: 404, statusMessage: 'Track not found' })

  const musicDir = useRuntimeConfig().musicDir
  if (!musicDir) throw createError({ statusCode: 500, statusMessage: 'MUSIC_DIR not configured' })

  const filePath = join(musicDir, track.filePath)

  let stat
  try {
    stat = statSync(filePath)
  }
  catch {
    throw createError({ statusCode: 404, statusMessage: 'Audio file not found on disk' })
  }

  const fileSize = stat.size
  const ext = filePath.split('.').pop()?.toLowerCase() || 'mp3'
  const mimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    wav: 'audio/wav',
  }
  const contentType = mimeTypes[ext] || 'audio/mpeg'

  const rangeHeader = getRequestHeader(event, 'range')

  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1

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
