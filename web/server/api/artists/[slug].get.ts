import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=600, stale-while-revalidate=60')

  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  return cachedResponse(`artist:${slug}`, 600, async () => {
    const artist = await prisma.artist.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        imageUrl: true,
        musicbrainzId: true,
        averageMatchScore: true,
        totalPlayCount: true,
        totalTracks: true,
        totalFileSize: true,
        lastSyncedAt: true,
        genres: { select: { id: true, name: true } },
        urls: { select: { id: true, type: true, url: true } },
      },
    })

    if (!artist) throw createError({ statusCode: 404, statusMessage: 'Artist not found' })

    const connectedStats = await prisma.artist.aggregate({
      where: { primaryArtistId: artist.id },
      _sum: { totalPlayCount: true, totalTracks: true, totalFileSize: true },
    })

    const relatedArtists = await prisma.$queryRaw<Array<{
      id: string
      name: string
      slug: string
      image: string | null
      imageUrl: string | null
    }>>`
      SELECT DISTINCT a.id, a.name, a.slug, a.image, a."imageUrl"
      FROM "Artist" a
      JOIN "TrackRelatedArtist" tra ON tra."artistId" = a.id
      JOIN "LocalReleaseTrack" lrt ON lrt.id = tra."trackId"
      JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
      WHERE lra."artistId" = ${artist.id}
        AND a.id != ${artist.id}
      ORDER BY a.name ASC
    `

    const img = verifyImage(artist.image, artist.imageUrl, 'artists')

    return {
      id: artist.id,
      name: artist.name,
      slug: artist.slug,
      image: img.image,
      imageUrl: img.imageUrl,
      musicbrainzId: artist.musicbrainzId,
      averageMatchScore: artist.averageMatchScore,
      totalPlayCount: artist.totalPlayCount + (connectedStats._sum.totalPlayCount || 0),
      totalTracks: artist.totalTracks + (connectedStats._sum.totalTracks || 0),
      totalFileSize: ((artist.totalFileSize || BigInt(0)) + (connectedStats._sum.totalFileSize || BigInt(0))).toString(),
      lastSyncedAt: artist.lastSyncedAt,
      genres: artist.genres,
      urls: artist.urls,
      relatedArtists: relatedArtists.map(a => ({
        ...a,
        ...verifyImage(a.image, a.imageUrl, 'artists'),
      })),
    }
  })
})
