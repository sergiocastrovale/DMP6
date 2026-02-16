import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  const [favoriteReleases, favoriteTracks] = await Promise.all([
    prisma.favoriteRelease.findMany({
      include: {
        release: {
          include: {
            artist: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            type: {
              select: {
                name: true,
              },
            },
            localReleases: {
              select: {
                id: true,
                title: true,
                year: true,
                image: true,
                imageUrl: true,
              },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.favoriteTrack.findMany({
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
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return {
    releases: favoriteReleases.map((fav) => {
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
            ? {
                id: fav.release.artist.id,
                name: fav.release.artist.name,
                slug: fav.release.artist.slug,
              }
            : null,
        },
      }
    }),
    tracks: favoriteTracks.map(fav => ({
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
              artist: fav.track.localRelease.artist
                ? {
                    id: fav.track.localRelease.artist.id,
                    name: fav.track.localRelease.artist.name,
                    slug: fav.track.localRelease.artist.slug,
                  }
                : null,
            }
          : null,
      },
    })),
  }
})
