import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  const playlists = await prisma.playlist.findMany({
    include: {
      _count: {
        select: {
          tracks: true,
        },
      },
      tracks: {
        take: 4,
        orderBy: { position: 'asc' },
        include: {
          track: {
            include: {
              localRelease: {
                select: {
                  image: true,
                  imageUrl: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return playlists.map(playlist => ({
    id: playlist.id,
    name: playlist.name,
    slug: playlist.slug,
    description: playlist.description,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
    trackCount: playlist._count.tracks,
    // Cover art: mosaic of first 4 track covers
    coverImages: playlist.tracks.map(pt => ({
      image: pt.track.localRelease?.image || null,
      imageUrl: pt.track.localRelease?.imageUrl || null,
    })),
  }))
})
