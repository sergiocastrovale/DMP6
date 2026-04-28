import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.view')

  const query = getQuery(event)
  const limit = query.limit ? Math.min(Number(query.limit), 100) : undefined
  const type = query.type as 'all' | 'genre' | 'manual' | undefined
  const typeFilter = type === 'genre' ? 'GENRE' : type === 'manual' ? 'MANUAL' : undefined

  const playlists = await prisma.playlist.findMany({
    ...(limit ? { take: limit } : {}),
    ...(typeFilter ? { where: { type: typeFilter } } : {}),
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
    type: playlist.type,
    genreGroup: playlist.genreGroup,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
    trackCount: playlist._count.tracks,
    // Cover art: mosaic of first 4 track covers
    coverImages: playlist.tracks.map(pt =>
      verifyImage(pt.track.localRelease?.image, pt.track.localRelease?.imageUrl, 'releases'),
    ),
  }))
})
