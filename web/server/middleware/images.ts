import { createReadStream, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const path = url.pathname

  // Only handle /img/artists/* and /img/releases/*
  const match = path.match(/^\/img\/(artists|releases)\/(.+)$/)
  if (!match) return

  const [, type, filename] = match

  // Prevent directory traversal
  if (filename.includes('..') || filename.includes('/')) return

  const imageDir = useRuntimeConfig().imageDir
  const filePath = resolve(join(imageDir, type, filename))

  let stat
  try {
    stat = statSync(filePath)
  }
  catch {
    throw createError({ statusCode: 404, statusMessage: 'Image not found' })
  }

  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg'
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
  }

  setResponseHeaders(event, {
    'Content-Type': mimeTypes[ext] || 'image/jpeg',
    'Content-Length': String(stat.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
  })

  return sendStream(event, createReadStream(filePath))
})
