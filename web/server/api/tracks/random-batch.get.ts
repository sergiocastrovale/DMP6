import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { fetchRandomTrackRows } from '~/server/utils/randomBatch'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const count = Math.min(Math.max(parseInt(query.count as string) || 10, 1), 30)

  const rows = await fetchRandomTrackRows(prisma, count)

  if (rows.length === 0) {return []}

  // Batch-fetch release data for all tracks in one query
  const releaseIds = [...new Set(rows.map(r => r.localReleaseId).filter(Boolean))] as string[]
  const releases = releaseIds.length > 0
    ? await prisma.localRelease.findMany({
        where: { id: { in: releaseIds } },
        select: {
          id: true,
          image: true,
          imageUrl: true,
          artists: { select: { artist: { select: { slug: true } } } },
        },
      })
    : []

  const releaseMap = new Map(releases.map(r => [r.id, r]))

  return rows.map(raw => {
    const release = raw.localReleaseId ? releaseMap.get(raw.localReleaseId) : null
    const img = verifyImage(release?.image, release?.imageUrl, 'releases')
    return {
      id: raw.id,
      title: raw.title || 'Unknown',
      artist: raw.artist || 'Unknown',
      album: raw.album || 'Unknown',
      duration: raw.duration || 0,
      artistSlug: release?.artists[0]?.artist?.slug || null,
      releaseImage: img.image,
      releaseImageUrl: img.imageUrl,
      localReleaseId: raw.localReleaseId,
    }
  })
})
