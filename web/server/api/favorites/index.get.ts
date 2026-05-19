import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { parsePagination } from '~/server/utils/pagination'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'favorites.view')

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
        skip,
        take: pageSize,
        include: {
          release: {
            include: {
              artists: {
                take: 1,
                select: { artist: { select: { id: true, name: true, slug: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.favoriteRelease.count(),
    ])
    totalReleases = count
    releases = rawReleases.map((fav) => {
      const img = verifyImage(fav.release.image, fav.release.imageUrl, 'releases')
      return {
        id: fav.id,
        createdAt: fav.createdAt,
        release: {
          id: fav.release.id,
          title: fav.release.title,
          year: fav.release.year,
          image: img.image,
          imageUrl: img.imageUrl,
          artist: fav.release.artists[0]?.artist ?? null,
        },
      }
    })
  }

  if (type === 'all' || type === 'tracks') {
    const [rawTracks, count] = await Promise.all([
      prisma.favoriteTrack.findMany({
        skip: type === 'all' ? skip : skip,
        take: pageSize,
        include: {
          track: {
            include: {
              localRelease: {
                include: {
                  artists: {
                    select: { artist: { select: { id: true, name: true, slug: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.favoriteTrack.count(),
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
