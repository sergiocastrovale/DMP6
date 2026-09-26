import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId, visiblePlaylistsWhere } from '~/server/utils/libraryOwnership'
import { PLAYLIST_PAGE_CAP } from '~/helpers/constants'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.view')
  const userId = currentUserId(event)

  const slug = getRouterParam(event, 'slug')

  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing playlist slug',
    })
  }

  const playlist = await prisma.playlist.findFirst({
    where: { slug, ...visiblePlaylistsWhere(userId) },
    orderBy: { userId: { sort: 'desc', nulls: 'last' } },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      type: true,
      createdAt: true,
      updatedAt: true,
      tracks: {
        take: PLAYLIST_PAGE_CAP,
        orderBy: { position: 'asc' },
        select: {
          id: true,
          position: true,
          createdAt: true,
          track: {
            select: {
              id: true,
              title: true,
              trackNumber: true,
              duration: true,
              localRelease: {
                select: {
                  id: true,
                  title: true,
                  year: true,
                  image: true,
                  imageUrl: true,
                  artists: { take: 1, select: { artist: { select: { id: true, name: true, slug: true } } } },
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
    type: playlist.type,
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
              ...verifyImage(pt.track.localRelease.image, pt.track.localRelease.imageUrl, 'releases'),
              artist: pt.track.localRelease.artists[0]?.artist ?? null,
            }
          : null,
      },
    })),
  }
})
