import type { DownloadSource } from '~/types/download'
import { startDownload } from '~/server/utils/downloads'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'

export default defineEventHandler(async (event) => {
  const { downloadsPath, downloadDirTemplate } = await resolveDownloadSettings()

  if (!downloadsPath) {
    throw createError({ statusCode: 503, message: 'DOWNLOADS_PATH not configured' })
  }

  const body = await readBody(event)
  const { source, username, files, deezerAlbumId, albumTitle, artistName, year } = body as {
    source: DownloadSource
    username?: string
    files?: { filename: string; size: number }[]
    deezerAlbumId?: string
    albumTitle?: string
    artistName?: string
    year?: number | null
  }

  if (!source) throw createError({ statusCode: 400, message: 'source is required' })

  return startDownload(
    source,
    { username, files, deezerAlbumId, albumTitle, artistName, year },
    downloadsPath,
    downloadDirTemplate,
  )
})
