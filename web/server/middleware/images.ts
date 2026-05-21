import { createReadStream, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const mimeTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const path = url.pathname

  const match = path.match(/^\/img\/(artists|releases|labs)\/(.+)$/)
  if (!match) { return }

  const type = match[1]!
  const filename = match[2]!

  if (filename.includes('..') || filename.includes('/')) { return }

  const { imageDir, remoteServerUrl } = useRuntimeConfig()
  const filePath = resolve(join(imageDir, type, filename))
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg'

  try {
    const stat = statSync(filePath)
    setResponseHeaders(event, {
      'Content-Type': mimeTypes[ext] || 'image/jpeg',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    return sendStream(event, createReadStream(filePath))
  }
  catch {
    // Local file missing — proxy from NAS if configured
  }

  if (remoteServerUrl) {
    return proxyRequest(event, `${remoteServerUrl}/img/${type}/${filename}`)
  }

  throw createError({ statusCode: 404, statusMessage: 'Image not found' })
})
