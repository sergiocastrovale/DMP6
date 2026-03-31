import { prisma } from '~/server/utils/prisma'

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-]/g, '')
    .replace(/[^\w\s]/g, '')
    .trim()
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  // Try as MusicBrainzRelease first
  const mbRelease = await prisma.musicBrainzRelease.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      localReleases: {
        select: { id: true },
        take: 1,
      },
      tracks: {
        select: {
          id: true,
          title: true,
          position: true,
          discNumber: true,
          durationMs: true,
        },
        orderBy: [{ discNumber: 'asc' }, { position: 'asc' }],
      },
    },
  })

  const localReleaseId = mbRelease?.localReleases[0]?.id

  if (localReleaseId) {
    return getLocalReleaseTracks(localReleaseId, mbRelease?.tracks)
  }

  // Try as LocalRelease
  return getLocalReleaseTracks(id)
})

async function getLocalReleaseTracks(
  localReleaseId: string,
  mbTracks?: { id: string; title: string; position: number | null; discNumber: number | null; durationMs: number | null }[],
) {
  const release = await prisma.localRelease.findUnique({
    where: { id: localReleaseId },
    select: {
      id: true,
      title: true,
      image: true,
      imageUrl: true,
      artists: { select: { artist: { select: { name: true, slug: true } } } },
    },
  })

  const albumArtistSlugs = new Set(
    release?.artists.map(a => a.artist.slug) ?? [],
  )

  const tracks = await prisma.localReleaseTrack.findMany({
    where: { localReleaseId },
    select: {
      id: true,
      title: true,
      artist: true,
      albumArtist: true,
      album: true,
      year: true,
      genre: true,
      duration: true,
      trackNumber: true,
      discNumber: true,
      playCount: true,
      filePath: true,
      localReleaseId: true,
      trackArtists: {
        where: { role: { in: ['PRIMARY', 'FEATURED'] } },
        select: {
          artist: { select: { name: true, slug: true } },
        },
      },
    },
    orderBy: [{ discNumber: 'asc' }, { trackNumber: 'asc' }],
  })

  const enrichedTracks = tracks.map(({ trackArtists, ...t }) => ({
    ...t,
    artists: trackArtists
      .filter(ta => !albumArtistSlugs.has(ta.artist.slug))
      .map(ta => ({ name: ta.artist.name, slug: ta.artist.slug })),
    missing: false,
  }))

  // Add missing MB tracks that have no local match (by normalized title)
  if (mbTracks) {
    const localTitleSet = new Set(
      tracks.map(t => normalizeTitle(t.title || '')),
    )
    for (const mbt of mbTracks) {
      if (!localTitleSet.has(normalizeTitle(mbt.title))) {
        enrichedTracks.push({
          id: mbt.id,
          title: mbt.title,
          artist: null,
          albumArtist: null,
          album: null,
          year: null,
          genre: null,
          duration: mbt.durationMs ? Math.round(mbt.durationMs / 1000) : null,
          trackNumber: mbt.position,
          discNumber: mbt.discNumber,
          playCount: 0,
          filePath: '',
          localReleaseId: null,
          artists: [],
          missing: true,
        })
      }
    }
    // Re-sort by disc then track number
    enrichedTracks.sort((a, b) => {
      const da = a.discNumber ?? 0
      const db = b.discNumber ?? 0
      if (da !== db) return da - db
      const ta = a.trackNumber ?? 0
      const tb = b.trackNumber ?? 0
      return ta - tb
    })
  }

  return {
    release: release
      ? {
          id: release.id,
          title: release.title,
          image: release.image,
          imageUrl: release.imageUrl,
          artistName: release.artists[0]?.artist?.name ?? 'Unknown',
          artistSlug: release.artists[0]?.artist?.slug ?? '',
        }
      : null,
    tracks: enrichedTracks,
  }
}
