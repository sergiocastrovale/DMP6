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
    },
  })

  if (!artist) throw createError({ statusCode: 404, statusMessage: 'Artist not found' })

  // Get all local release IDs where this artist has tracks (via TrackArtist)
  const artistTrackLinks = await prisma.trackArtist.findMany({
    where: { artistId: artist.id },
    select: { track: { select: { localReleaseId: true } } },
  })
  const releaseIds = [...new Set(
    artistTrackLinks.map((ta) => ta.track.localReleaseId).filter(Boolean),
  )] as string[]

  // Fetch those local releases
  const localReleases = await prisma.localRelease.findMany({
    where: { id: { in: releaseIds } },
    select: {
      id: true,
      title: true,
      year: true,
      image: true,
      imageUrl: true,
      matchStatus: true,
      releaseId: true,
      tracks: { select: { id: true } },
    },
    orderBy: [{ year: 'asc' }, { title: 'asc' }],
  })

  // Index local releases by their MB releaseId for quick lookup
  const localByMbId = new Map<string, typeof localReleases[number]>()
  const unmatchedLocal: typeof localReleases = []
  for (const lr of localReleases) {
    if (lr.releaseId) {
      localByMbId.set(lr.releaseId, lr)
    } else {
      unmatchedLocal.push(lr)
    }
  }

  // Build unified release list from MB releases
  const releases = artist.mbReleases.map((mbr) => {
    // Prefer a local release found via TrackArtist, fall back to the MB relation
    const localRelease = localByMbId.get(mbr.id) || mbr.localReleases[0] || null
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

  // Track which local releases were already represented by an MB release
  const mbLinkedReleaseIds = new Set(
    releases.map((r) => r.localReleaseId).filter(Boolean),
  )

  // Add unmatched local releases (found via TrackArtist, not linked to any MB release,
  // and not already included via an MB release's localReleases)
  for (const lr of unmatchedLocal) {
    if (mbLinkedReleaseIds.has(lr.id)) continue
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

  // Also add any local releases from TrackArtist that are matched to an MB release
  // but whose MB release isn't in this artist's mbReleases (collaboration albums)
  const mbReleaseIds = new Set(artist.mbReleases.map((mbr) => mbr.id))
  for (const lr of localReleases) {
    if (!lr.releaseId) continue
    if (mbReleaseIds.has(lr.releaseId)) continue
    if (mbLinkedReleaseIds.has(lr.id)) continue
    releases.push({
      id: lr.id,
      title: lr.title,
      year: lr.year,
      type: 'Appears On',
      typeSlug: 'appears-on',
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
