import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  const count = await prisma.localReleaseTrack.count()
  if (count === 0) return null

  const skip = Math.floor(Math.random() * count)

  const track = await prisma.localReleaseTrack.findFirst({
    skip,
    select: {
      id: true,
      title: true,
      artist: true,
      album: true,
      duration: true,
      localReleaseId: true,
      localRelease: {
        select: {
          image: true,
          imageUrl: true,
          artist: { select: { slug: true } },
        },
      },
    },
  })

  if (!track) return null

  return {
    id: track.id,
    title: track.title || 'Unknown',
    artist: track.artist || 'Unknown',
    album: track.album || 'Unknown',
    duration: track.duration || 0,
    artistSlug: track.localRelease?.artist?.slug || null,
    releaseImage: track.localRelease?.image || null,
    releaseImageUrl: track.localRelease?.imageUrl || null,
    localReleaseId: track.localReleaseId,
  }
})
