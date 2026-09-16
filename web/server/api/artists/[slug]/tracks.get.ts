import { prisma } from '~/server/utils/prisma'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { trackPlaysByIds, withTrackPlay } from '~/server/utils/userPlays'

export default defineEventHandler(async (event) => {
  const userId = currentUserId(event)
  const slug = getRouterParam(event, 'slug')
  if (!slug) {throw createError({ statusCode: 400, statusMessage: 'Missing slug' })}

  const artist = await prisma.artist.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!artist) {throw createError({ statusCode: 404, statusMessage: 'Artist not found' })}

  const tracks = await prisma.localReleaseTrack.findMany({
    where: {
      OR: [
        { localRelease: { artists: { some: { artistId: artist.id } } } },
        { trackRelatedArtists: { some: { artistId: artist.id } } },
      ],
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
      filePath: true,
      localReleaseId: true,
      trackRelatedArtists: {
        select: {
          artist: { select: { name: true, slug: true } },
        },
      },
    },
    orderBy: [{ album: 'asc' }, { discNumber: 'asc' }, { trackNumber: 'asc' }],
    take: 2000,
  })

  const plays = await trackPlaysByIds(userId, tracks.map(t => t.id))

  return tracks.map(({ trackRelatedArtists, ...t }) => ({
    ...withTrackPlay(t, plays),
    artists: trackRelatedArtists.map(ta => ({
      name: ta.artist.name,
      slug: ta.artist.slug,
    })),
  }))
})
