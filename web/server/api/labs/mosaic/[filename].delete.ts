import { existsSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const filename = getRouterParam(event, 'filename')
  if (!filename || !filename.startsWith('mosaic_') || !filename.endsWith('.jpg')) {
    throw createError({ statusCode: 400, message: 'Invalid filename' })
  }

  if (filename.includes('/') || filename.includes('..')) {
    throw createError({ statusCode: 400, message: 'Invalid filename' })
  }

  const { imageDir, remoteServerUrl } = useRuntimeConfig()

  if (remoteServerUrl) {
    const cookie = getRequestHeader(event, 'cookie') || ''
    return $fetch(`${remoteServerUrl}/api/labs/mosaic/${filename}`, {
      method: 'DELETE',
      headers: { cookie },
    })
  }

  const labsDir = join(resolve(imageDir), 'labs')
  const fullPath = join(labsDir, filename)
  if (existsSync(fullPath)) {
    unlinkSync(fullPath)
    const previewPath = join(labsDir, filename.replace('.jpg', '_preview.jpg'))
    if (existsSync(previewPath)) {
      unlinkSync(previewPath)
    }
  }

  return { ok: true }
})
