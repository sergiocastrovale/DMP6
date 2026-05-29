import { startDownload } from '~/server/utils/downloads'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'

export default defineEventHandler(async (event) => {
  const { downloadsPath, downloadDirTemplate } = await resolveDownloadSettings()

  if (!downloadsPath) {
    throw createError({ statusCode: 503, message: 'DOWNLOADS_PATH not configured' })
  }

  const body = await readBody(event)
  const { username, files, albumTitle, artistName, year } = body as {
    username?: string
    files?: { filename: string; size: number }[]
    albumTitle?: string
    artistName?: string
    year?: number | null
  }

  return startDownload(
    { username, files, albumTitle, artistName, year },
    downloadsPath,
    downloadDirTemplate,
  )
})
