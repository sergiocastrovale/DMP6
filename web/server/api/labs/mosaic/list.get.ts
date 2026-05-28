import { existsSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import type { MosaicItem } from '~/types/labs'

export default defineEventHandler(async (event): Promise<MosaicItem[]> => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const { imageDir, remoteServerUrl } = useRuntimeConfig()

  if (remoteServerUrl) {
    const cookie = getRequestHeader(event, 'cookie') || ''
    return $fetch<MosaicItem[]>(`${remoteServerUrl}/api/labs/mosaic/list`, {
      headers: { cookie },
    })
  }

  const labsDir = join(resolve(imageDir), 'labs')

  if (!existsSync(labsDir)) {
    return []
  }

  return readdirSync(labsDir)
    .filter((f) => f.startsWith('mosaic_') && f.endsWith('.jpg') && !f.includes('_preview'))
    .sort()
    .reverse()
    .map((filename) => {
      const stats = statSync(join(labsDir, filename))
      const previewFilename = filename.replace('.jpg', '_preview.jpg')
      const hasPreview = existsSync(join(labsDir, previewFilename))

      const countMatch = filename.match(/^mosaic_\d{8}_\d{6}_(\d+)\.jpg$/)
      const imageCount = countMatch?.[1] ? parseInt(countMatch[1], 10) : null

      return {
        filename,
        previewFilename: hasPreview ? previewFilename : null,
        createdAt: stats.mtime.toISOString(),
        size: stats.size,
        imageCount,
      }
    })
})
