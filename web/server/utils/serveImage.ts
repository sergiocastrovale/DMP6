import { createReadStream, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { H3Event } from 'h3'

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}

// Stat + stream a local image file, falling back to the NAS proxy when this instance doesn't have
// it on disk. Shared by server/middleware/images.ts (/img/*) and /rest/getCoverArt
// (server/utils/subsonic/endpoints/media.ts) - the caller has already validated `filename`
// (no `..`/`/`) and resolved which of image/imageUrl to use (server/utils/images.ts's verifyImage).
export const serveLocalImage = async (
  event: H3Event,
  type: 'artists' | 'releases' | 'labs',
  filename: string,
) => {
  const { imageDir, remoteServerUrl } = useRuntimeConfig()
  const filePath = resolve(join(imageDir, type, filename))
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg'

  try {
    const stat = statSync(filePath)
    setResponseHeaders(event, {
      'Content-Type': MIME_TYPES[ext] || 'image/jpeg',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    return sendStream(event, createReadStream(filePath))
  }
  catch {
    // Local file missing - proxy from NAS if configured
  }

  if (remoteServerUrl) {
    return proxyRequest(event, `${remoteServerUrl}/img/${type}/${filename}`)
  }

  throw createError({ statusCode: 404, statusMessage: 'Image not found' })
}
