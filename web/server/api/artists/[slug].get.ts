import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=600, stale-while-revalidate=60')

  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

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
  }
})
