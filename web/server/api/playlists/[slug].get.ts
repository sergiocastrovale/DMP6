import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')

  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing playlist slug',
    })
  }

  const playlist = await prisma.playlist.findUnique({
    where: { slug },
    include: {
      tracks: {
        orderBy: { position: 'asc' },
        include: {
          track: {
            include: {
              localRelease: {
                include: {
                  artist: {
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!playlist) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Playlist not found',
    })
  }

  return {
    id: playlist.id,
    name: playlist.name,
    slug: playlist.slug,
    description: playlist.description,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
    tracks: playlist.tracks.map(pt => ({
      id: pt.id,
      position: pt.position,
      addedAt: pt.createdAt,
      track: {
        id: pt.track.id,
        title: pt.track.title,
        trackNumber: pt.track.trackNumber,
        duration: pt.track.duration,
        release: pt.track.localRelease
          ? {
              id: pt.track.localRelease.id,
              title: pt.track.localRelease.title,
              year: pt.track.localRelease.year,
              image: pt.track.localRelease.image,
              imageUrl: pt.track.localRelease.imageUrl,
              artist: pt.track.localRelease.artist
                ? {
                    id: pt.track.localRelease.artist.id,
                    name: pt.track.localRelease.artist.name,
                    slug: pt.track.localRelease.artist.slug,
                  }
                : null,
            }
          : null,
      },
    })),
  }
})
