import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'

interface RawTrack {
  id: string
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  localReleaseId: string | null
}

export default defineEventHandler(async () => {
  // TABLESAMPLE BERNOULLI: O(1) random selection regardless of table size
  let rows = await prisma.$queryRaw<RawTrack[]>`
    SELECT id, title, artist, album, duration, "localReleaseId"
    FROM "LocalReleaseTrack"
    TABLESAMPLE BERNOULLI(0.01)
    LIMIT 1
  `

  // Fallback to larger sample if empty (rare with 2.5M rows)
  if (rows.length === 0) {
    rows = await prisma.$queryRaw<RawTrack[]>`
      SELECT id, title, artist, album, duration, "localReleaseId"
      FROM "LocalReleaseTrack"
      TABLESAMPLE BERNOULLI(1)
      LIMIT 1
    `
  }

  if (rows.length === 0) return null

  const raw = rows[0]!

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
