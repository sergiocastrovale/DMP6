import { startDownload } from '~/server/utils/downloads'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { acquireRelease } from '~/server/utils/acquire'
import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const { downloadsPath, downloadDirTemplate } = await resolveDownloadSettings()

  if (!downloadsPath) {
    throw createError({ statusCode: 503, message: 'DOWNLOADS_PATH not configured' })
  }

  const body = await readBody(event)
  const { username, files, albumTitle, artistName, year, mbReleaseRowId, artistId, format, avgBitrate } = body as {
    username?: string
    files?: { filename: string; size: number }[]
    albumTitle?: string
    artistName?: string
    year?: number | null
    mbReleaseRowId?: string | null
    artistId?: string | null
    format?: string
    avgBitrate?: number
  }

  // Release context present -> record in the approval queue (DownloadedRelease) so manual
  // dialog downloads converge with auto-monitoring. acquireRelease enqueues + moves + transcodes.
  if (mbReleaseRowId && username && files?.length && artistName && albumTitle) {
    // Resolve the artist server-side so the artist-page poll sees this row.
    let resolvedArtistId = artistId ?? null
    if (!resolvedArtistId) {
      const link = await prisma.musicBrainzReleaseArtist.findFirst({
        where: { releaseId: mbReleaseRowId },
        select: { artistId: true },
      })
      resolvedArtistId = link?.artistId ?? null
    }
    // Reuse a prior terminal row for this release (reset the attempt cap — manual override).
    const prior = await prisma.downloadedRelease.findFirst({
      where: { mbReleaseId: mbReleaseRowId, status: { in: ['FAILED', 'ABANDONED', 'REJECTED'] } },
      select: { id: true },
    })
    if (prior) await prisma.downloadedRelease.update({ where: { id: prior.id }, data: { attempts: 0 } })

    const { id } = await acquireRelease({
      result: { username, files, format, avgBitrate },
      artistId: resolvedArtistId,
      artistName,
      albumTitle,
      year: year ?? null,
      mbReleaseId: mbReleaseRowId,
    }, prior?.id)
    return { success: true, downloadedReleaseId: id }
  }

  return startDownload(
    { username, files, albumTitle, artistName, year },
    downloadsPath,
    downloadDirTemplate,
  )
})
