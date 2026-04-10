import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

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

    // Related artists tied to this one: globally "related" (no TrackArtist rows, i.e.
    // pulled in via compound-split) AND sharing at least one LocalReleaseArtist with
    // the current artist. Mirrors the mainArtists/relatedArtists split in Statistics.
    const relatedArtists = await prisma.$queryRaw<Array<{
      id: string
      name: string
      slug: string
      image: string | null
      imageUrl: string | null
    }>>`
      SELECT DISTINCT a.id, a.name, a.slug, a.image, a."imageUrl"
      FROM "Artist" a
      WHERE a.id != ${artist.id}
        AND NOT EXISTS (SELECT 1 FROM "TrackArtist" ta WHERE ta."artistId" = a.id)
        AND EXISTS (
          SELECT 1 FROM "LocalReleaseArtist" lra
          WHERE lra."artistId" = a.id
            AND lra."localReleaseId" IN (
              SELECT "localReleaseId" FROM "LocalReleaseArtist" WHERE "artistId" = ${artist.id}
            )
        )
      ORDER BY a.name ASC
    `

    return {
      id: artist.id,
      name: artist.name,
      slug: artist.slug,
      image: artist.image,
      imageUrl: artist.imageUrl,
      musicbrainzId: artist.musicbrainzId,
      averageMatchScore: artist.averageMatchScore,
      totalPlayCount: artist.totalPlayCount,
      totalTracks: artist.totalTracks,
      totalFileSize: artist.totalFileSize?.toString() || '0',
      lastSyncedAt: artist.lastSyncedAt,
      genres: artist.genres,
      urls: artist.urls,
      relatedArtists,
    }
  })
})
