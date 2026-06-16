import { prisma } from '~/server/utils/prisma'
import { computeDownloadPercent } from '~/server/utils/downloadProgress'

// Lightweight poll target for the artist page: in-flight acquisition state per MB release.
// No release recompute — just the DownloadedRelease rows for this artist.
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const artist = await prisma.artist.findUnique({ where: { slug }, select: { id: true } })
  if (!artist) throw createError({ statusCode: 404, statusMessage: 'Artist not found' })

  const items = await prisma.downloadedRelease.findMany({
    where: {
      artistId: artist.id,
      status: { in: ['DOWNLOADING', 'ENRICHING', 'READY', 'FAILED', 'ABANDONED'] },
    },
    select: { id: true, mbReleaseId: true, status: true, files: true, bytesTransferred: true },
    orderBy: { updatedAt: 'desc' },
  })

  return {
    items: items.map(i => ({
      mbReleaseId: i.mbReleaseId,
      status: i.status,
      downloadedReleaseId: i.id,
      ...computeDownloadPercent(i),
    })),
  }
})
