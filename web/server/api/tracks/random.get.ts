import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { fetchRandomTrackRows } from '~/server/utils/randomBatch'

export default defineEventHandler(async () => {
  const [raw] = await fetchRandomTrackRows(prisma, 1)
  if (!raw) {return null}

  // Fetch release image data - single PK lookup, instant
  const release = raw.localReleaseId
    ? await prisma.localRelease.findUnique({
        where: { id: raw.localReleaseId },
        select: {
          image: true,
          imageUrl: true,
          artists: { select: { artist: { select: { slug: true } } } },
        },
      })
    : null

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
