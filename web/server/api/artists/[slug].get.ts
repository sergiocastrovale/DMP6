import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { artistPlayTotals } from '~/server/utils/userPlays'
import { fetchRelatedArtists } from '~/server/utils/relatedArtists'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=600, stale-while-revalidate=60')
  const userId = currentUserId(event)

  const slug = getRouterParam(event, 'slug')
  if (!slug) {throw createError({ statusCode: 400, statusMessage: 'Missing slug' })}

  const cached = await cachedResponse(`artist:${slug}`, 600, async () => {
    const artist = await prisma.artist.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        imageUrl: true,
        musicbrainzId: true,
        completeness: true,
        totalTracks: true,
        totalFileSize: true,
        lastSyncedAt: true,
        monitored: true,
        genres: { select: { id: true, name: true } },
        urls: { select: { id: true, type: true, url: true } },
      },
    })

    if (!artist) {throw createError({ statusCode: 404, statusMessage: 'Artist not found' })}

    // Independent of each other, so one round trip's worth of latency instead of three.
    const [connectedArtists, connectedStats, relatedArtists] = await Promise.all([
      prisma.artist.findMany({ where: { primaryArtistId: artist.id }, select: { id: true } }),
      prisma.artist.aggregate({
        where: { primaryArtistId: artist.id },
        _sum: { totalTracks: true, totalFileSize: true },
      }),
      fetchRelatedArtists(artist.id),
    ])

    const img = verifyImage(artist.image, artist.imageUrl, 'artists')

    return {
      id: artist.id,
      name: artist.name,
      slug: artist.slug,
      image: img.image,
      imageUrl: img.imageUrl,
      musicbrainzId: artist.musicbrainzId,
      completeness: artist.completeness,
      connectedArtistIds: connectedArtists.map(a => a.id),
      totalTracks: artist.totalTracks + (connectedStats._sum.totalTracks || 0),
      totalFileSize: ((artist.totalFileSize || BigInt(0)) + (connectedStats._sum.totalFileSize || BigInt(0))).toString(),
      lastSyncedAt: artist.lastSyncedAt,
      monitored: artist.monitored,
      genres: artist.genres,
      urls: artist.urls,
      relatedArtists: relatedArtists.map(a => ({
        ...a,
        ...verifyImage(a.image, a.imageUrl, 'artists'),
      })),
    }
  }, { shared: true })

  const playTotals = await artistPlayTotals(userId, [cached.id, ...cached.connectedArtistIds])
  const totalPlayCount = [...playTotals.values()].reduce((sum, n) => sum + n, 0)
  const { connectedArtistIds: _connectedArtistIds, ...rest } = cached

  return { ...rest, totalPlayCount }
})
