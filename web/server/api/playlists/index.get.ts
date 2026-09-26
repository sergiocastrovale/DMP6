import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId, visiblePlaylistsWhere } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.view')
  const userId = currentUserId(event)

  const query = getQuery(event)
  const limit = query.limit ? Math.min(Number(query.limit), 100) : undefined
  const type = query.type as 'all' | 'genre' | 'region' | 'manual' | undefined
  const typeFilter = type === 'genre' ? 'GENRE' : type === 'region' ? 'REGION' : type === 'manual' ? 'MANUAL' : undefined

  const playlists = await prisma.playlist.findMany({
    ...(limit ? { take: limit } : {}),
    where: {
      ...visiblePlaylistsWhere(userId),
      ...(typeFilter ? { type: typeFilter } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      type: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { tracks: true } },
      // The cover mosaic only needs the first four tracks' release art.
      tracks: {
        take: 4,
        orderBy: { position: 'asc' },
        select: { track: { select: { localRelease: { select: { image: true, imageUrl: true } } } } },
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
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
    trackCount: playlist._count.tracks,
    // Cover art: mosaic of first 4 track covers
    coverImages: playlist.tracks.map(pt =>
      verifyImage(pt.track.localRelease?.image, pt.track.localRelease?.imageUrl, 'releases'),
    ),
  }))
})
