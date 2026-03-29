import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const type = (query.type as string) || 'all'
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50))
  const skip = (page - 1) * pageSize

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
              artist: {
                select: { id: true, name: true, slug: true },
              },
              type: {
                select: { name: true },
              },
              localReleases: {
                select: {
                  id: true, title: true, year: true, image: true, imageUrl: true,
                },
                take: 1,
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
      const localRelease = fav.release.localReleases[0]
      return {
        id: fav.id,
        createdAt: fav.createdAt,
        release: {
          id: localRelease?.id || fav.release.id,
          title: fav.release.title,
          releaseType: fav.release.type?.name || null,
          year: localRelease?.year || fav.release.year,
          image: localRelease?.image || null,
          imageUrl: localRelease?.imageUrl || null,
          artist: fav.release.artist
            ? { id: fav.release.artist.id, name: fav.release.artist.name, slug: fav.release.artist.slug }
            : null,
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
    tracks = rawTracks.map(fav => ({
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
              image: fav.track.localRelease.image,
              imageUrl: fav.track.localRelease.imageUrl,
              artist: fav.track.localRelease.artists[0]?.artist ?? null,
            }
          : null,
      },
    }))
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
