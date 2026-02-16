import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const artist = await prisma.artist.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!artist) throw createError({ statusCode: 404, statusMessage: 'Artist not found' })

  const tracks = await prisma.localReleaseTrack.findMany({
    where: {
      localRelease: { artistId: artist.id },
    },
    select: {
      id: true,
      title: true,
      artist: true,
      albumArtist: true,
      album: true,
      year: true,
      genre: true,
      duration: true,
      trackNumber: true,
      discNumber: true,
      playCount: true,
      filePath: true,
      localReleaseId: true,
    },
    orderBy: [{ album: 'asc' }, { discNumber: 'asc' }, { trackNumber: 'asc' }],
  })

  return tracks
})
