import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const searchQuery = query.q as string

  if (!searchQuery || searchQuery.length < 2) {
    return {
      artists: [],
      releases: [],
      tracks: [],
    }
  }

  const [artists, releases, tracks] = await Promise.all([
    // Search artists
    prisma.artist.findMany({
      where: {
        name: {
          contains: searchQuery,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        imageUrl: true,
      },
      take: 5,
      orderBy: [
        { averageMatchScore: 'desc' },
        { name: 'asc' },
      ],
    }),

    // Search releases
    prisma.localRelease.findMany({
      where: {
        OR: [
          {
            title: {
              contains: searchQuery,
              mode: 'insensitive',
            },
          },
          {
            release: {
              title: {
                contains: searchQuery,
                mode: 'insensitive',
              },
            },
          },
        ],
      },
      include: {
        artist: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        release: {
          select: {
            title: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),

    // Search tracks
    prisma.localReleaseTrack.findMany({
      where: {
        title: {
          contains: searchQuery,
          mode: 'insensitive',
        },
      },
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
      take: 5,
      orderBy: { title: 'asc' },
    }),
  ])

  return {
    artists: artists.map(artist => ({
      id: artist.id,
      name: artist.name,
      slug: artist.slug,
      image: artist.image,
      imageUrl: artist.imageUrl,
    })),
    releases: releases.map(release => ({
      id: release.id,
      title: release.title || release.release?.title || 'Unknown Release',
      releaseType: release.release?.type?.name || null,
      year: release.year,
      image: release.image,
      imageUrl: release.imageUrl,
      artist: release.artist
        ? {
            id: release.artist.id,
            name: release.artist.name,
            slug: release.artist.slug,
          }
        : null,
    })),
    tracks: tracks.map(track => ({
      id: track.id,
      title: track.title,
      trackNumber: track.trackNumber,
      duration: track.duration,
      release: track.localRelease
        ? {
            id: track.localRelease.id,
            title: track.localRelease.title,
            year: track.localRelease.year,
            image: track.localRelease.image,
            imageUrl: track.localRelease.imageUrl,
            artist: track.localRelease.artist
              ? {
                  id: track.localRelease.artist.id,
                  name: track.localRelease.artist.name,
                  slug: track.localRelease.artist.slug,
                }
              : null,
          }
        : null,
    })),
  }
})
