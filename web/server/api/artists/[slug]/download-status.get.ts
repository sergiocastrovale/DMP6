import { prisma } from '~/server/utils/prisma'
import { computeDownloadPercent } from '~/server/utils/downloadProgress'

// Lightweight poll target for the artist page: in-flight acquisition state per MB release.
// No release recompute — just the DownloadedRelease rows for this artist.
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) {throw createError({ statusCode: 400, statusMessage: 'Missing slug' })}

  const artist = await prisma.artist.findUnique({ where: { slug }, select: { id: true } })
  if (!artist) {throw createError({ statusCode: 404, statusMessage: 'Artist not found' })}

  const items = await prisma.downloadedRelease.findMany({
    where: {
      artistId: artist.id,
      status: { in: ['SEARCHING', 'DOWNLOADING', 'ENRICHING', 'READY', 'FAILED', 'ABANDONED'] },
    },
    select: { id: true, mbReleaseId: true, replacesLocalReleaseId: true, status: true, files: true, bytesTransferred: true },
    orderBy: { updatedAt: 'desc' },
  })

  return {
    items: items.map(i => ({
      mbReleaseId: i.mbReleaseId,
      // Several LocalReleases can share one MB release (duplicate copies, or disc halves not yet
      // merged). A re-download targets exactly one of them, so the row it replaces is what lets the
      // artist page light up that card alone instead of every card carrying the MB id.
      replacesLocalReleaseId: i.replacesLocalReleaseId,
      status: i.status,
      downloadedReleaseId: i.id,
      ...computeDownloadPercent(i),
    })),
  }
})
