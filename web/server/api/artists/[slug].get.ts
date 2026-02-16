import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const artist = await prisma.artist.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      image: true,
      imageUrl: true,
      musicbrainzId: true,
      averageMatchScore: true,
      totalPlayCount: true,
      totalTracks: true,
      totalFileSize: true,
      lastSyncedAt: true,
      genres: { select: { id: true, name: true } },
      urls: { select: { id: true, type: true, url: true } },
      mbReleases: {
        select: {
          id: true,
          title: true,
          year: true,
          musicbrainzId: true,
          status: true,
          type: { select: { name: true, slug: true } },
          tracks: { select: { id: true } },
          localReleases: {
            select: {
              id: true,
              title: true,
              image: true,
              imageUrl: true,
              tracks: { select: { id: true } },
            },
          },
        },
        orderBy: [{ year: 'asc' }, { title: 'asc' }],
      },
      localReleases: {
        where: { releaseId: null },
        select: {
          id: true,
          title: true,
          year: true,
          image: true,
          imageUrl: true,
          matchStatus: true,
          tracks: { select: { id: true } },
        },
        orderBy: [{ year: 'asc' }, { title: 'asc' }],
      },
    },
  })

  if (!artist) throw createError({ statusCode: 404, statusMessage: 'Artist not found' })

  // Build unified release list
  const releases = artist.mbReleases.map((mbr) => {
    const localRelease = mbr.localReleases[0] || null
    return {
      id: mbr.id,
      title: mbr.title,
      year: mbr.year,
      type: mbr.type.name,
      typeSlug: mbr.type.slug,
      musicbrainzId: mbr.musicbrainzId,
      status: mbr.status,
      image: localRelease?.image || null,
      imageUrl: localRelease?.imageUrl || null,
      trackCount: mbr.tracks.length,
      localTrackCount: localRelease?.tracks.length || 0,
      isMusicBrainz: true,
      localReleaseId: localRelease?.id || null,
    }
  })

  // Add unmatched local releases
  for (const lr of artist.localReleases) {
    releases.push({
      id: lr.id,
      title: lr.title,
      year: lr.year,
      type: 'Unmatched',
      typeSlug: 'unmatched',
      musicbrainzId: null,
      status: lr.matchStatus,
      image: lr.image,
      imageUrl: lr.imageUrl,
      trackCount: 0,
      localTrackCount: lr.tracks.length,
      isMusicBrainz: false,
      localReleaseId: lr.id,
    })
  }

  return {
    id: artist.id,
    name: artist.name,
    slug: artist.slug,
    image: artist.image,
    imageUrl: artist.imageUrl,
    musicbrainzId: artist.musicbrainzId,
    averageMatchScore: artist.averageMatchScore,
    totalPlayCount: artist.totalPlayCount,
    totalTracks: artist.totalTracks,
    totalFileSize: artist.totalFileSize?.toString() || '0',
    lastSyncedAt: artist.lastSyncedAt,
    genres: artist.genres,
    urls: artist.urls,
    releases,
  }
})
