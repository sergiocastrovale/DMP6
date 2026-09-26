import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { parsePagination } from '~/server/utils/pagination'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { favoriteReleaseCard, favoriteReleaseSelect } from '~/server/utils/favorites'

const artistFirst = { take: 1, select: { artist: { select: { id: true, name: true, slug: true } } } } as const

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.view')
  const userId = currentUserId(event)

  const query = getQuery(event)
  const type = (query.type as string) || 'all'
  const { page, pageSize, skip } = parsePagination(query, { defaultSize: 50, maxSize: 100 })

  let releases: any[] = []
  let tracks: any[] = []
  let totalReleases = 0
  let totalTracks = 0

  if (type === 'all' || type === 'releases') {
    const [rawReleases, count] = await Promise.all([
      prisma.favoriteRelease.findMany({
        where: { userId },
        skip,
        take: pageSize,
        select: favoriteReleaseSelect,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.favoriteRelease.count({ where: { userId } }),
    ])
    totalReleases = count
    releases = rawReleases.flatMap((fav) => {
      const release = favoriteReleaseCard(fav)
      return release ? [{ id: fav.id, createdAt: fav.createdAt, release }] : []
    })
  }

  if (type === 'all' || type === 'tracks') {
    const [rawTracks, count] = await Promise.all([
      prisma.favoriteTrack.findMany({
        where: { userId },
        skip,
        take: pageSize,
        select: {
          id: true,
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
                  artists: artistFirst,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.favoriteTrack.count({ where: { userId } }),
    ])
    totalTracks = count
    tracks = rawTracks.map((fav) => {
      const trackImg = fav.track.localRelease
        ? verifyImage(fav.track.localRelease.image, fav.track.localRelease.imageUrl, 'releases')
        : null
      return {
        id: fav.id,
        createdAt: fav.createdAt,
        track: {
          id: fav.track.id,
          title: fav.track.title,
          trackNumber: fav.track.trackNumber,
          duration: fav.track.duration,
          release: fav.track.localRelease
            ? {
                id: fav.track.localRelease.id,
                title: fav.track.localRelease.title,
                year: fav.track.localRelease.year,
                image: trackImg!.image,
                imageUrl: trackImg!.imageUrl,
                artist: fav.track.localRelease.artists[0]?.artist ?? null,
              }
            : null,
        },
      }
    })
  }

  return {
    releases,
    tracks,
    totalReleases,
    totalTracks,
    page,
    pageSize,
    hasMoreReleases: skip + pageSize < totalReleases,
    hasMoreTracks: skip + pageSize < totalTracks,
  }
})
