import { prisma } from '~/server/utils/prisma'

interface RawTrack {
  id: string
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  localReleaseId: string | null
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const count = Math.min(Math.max(parseInt(query.count as string) || 10, 1), 30)

  // TABLESAMPLE with slightly larger sample to reliably get N tracks
  let rows = await prisma.$queryRaw<RawTrack[]>`
    SELECT id, title, artist, album, duration, "localReleaseId"
    FROM "LocalReleaseTrack"
    TABLESAMPLE BERNOULLI(0.05)
    LIMIT ${count}
  `

  // Fallback to larger sample if insufficient
  if (rows.length < count) {
    rows = await prisma.$queryRaw<RawTrack[]>`
      SELECT id, title, artist, album, duration, "localReleaseId"
      FROM "LocalReleaseTrack"
      TABLESAMPLE BERNOULLI(1)
      LIMIT ${count}
    `
  }

  if (rows.length === 0) return []

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
    return {
      id: raw.id,
      title: raw.title || 'Unknown',
      artist: raw.artist || 'Unknown',
      album: raw.album || 'Unknown',
      duration: raw.duration || 0,
      artistSlug: release?.artists[0]?.artist?.slug || null,
      releaseImage: release?.image || null,
      releaseImageUrl: release?.imageUrl || null,
      localReleaseId: raw.localReleaseId,
    }
  })
})
