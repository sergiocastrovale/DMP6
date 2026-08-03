import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-]/g, '')
    .replace(/[^\w\s]/g, '')
    .trim()
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {throw createError({ statusCode: 400, statusMessage: 'Missing id' })}

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
          musicbrainzId: true,
        },
        orderBy: [{ discNumber: 'asc' }, { position: 'asc' }],
      },
    },
  })

  const localReleaseId = mbRelease?.localReleases[0]?.id

  if (localReleaseId) {
    return getLocalReleaseTracks(localReleaseId, mbRelease?.tracks)
  }

  if (mbRelease) {
    return {
      release: {
        id: mbRelease.id,
        title: mbRelease.title,
        image: null,
        imageUrl: null,
        artistName: 'Unknown',
        artistSlug: '',
      },
      tracks: (mbRelease.tracks ?? []).map(mbt => ({
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
        mbTitle: null,
        mbTrackMusicbrainzId: mbt.musicbrainzId || null,
      })),
    }
  }

  // Try as LocalRelease - also fetch its MB release tracks if linked.
  const localRelease = await prisma.localRelease.findUnique({
    where: { id },
    select: {
      releaseId: true,
      release: {
        select: {
          tracks: {
            select: {
              id: true,
              title: true,
              position: true,
              discNumber: true,
              durationMs: true,
              musicbrainzId: true,
            },
            orderBy: [{ discNumber: 'asc' }, { position: 'asc' }],
          },
        },
      },
    },
  })

  return getLocalReleaseTracks(id, localRelease?.release?.tracks)
})

async function getLocalReleaseTracks(
  localReleaseId: string,
  mbTracks?: { id: string; title: string; position: number | null; discNumber: number | null; durationMs: number | null; musicbrainzId: string | null }[],
) {
  const release = await prisma.localRelease.findUnique({
    where: { id: localReleaseId },
    select: {
      id: true,
      title: true,
      image: true,
      imageUrl: true,
      artists: { select: { artist: { select: { name: true, slug: true, primaryArtistId: true, primaryArtist: { select: { name: true, slug: true } } } } } },
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
      mbTrack: {
        select: { id: true, title: true, musicbrainzId: true },
      },
      trackRelatedArtists: {
        select: {
          artist: { select: { name: true, slug: true } },
        },
      },
    },
    orderBy: [{ discNumber: 'asc' }, { trackNumber: 'asc' }],
  })

  // Build enriched tracks, checking for MB title differences via substring matching
  const enrichedTracks: any[] = []
  const matchedMbIds = new Set<string>()

  for (const { trackRelatedArtists, mbTrack, ...t } of tracks) {
    let mbTitle: string | null = null

    if (mbTracks) {
      const localNorm = normalizeTitle(t.title || '')
      let matchedMb: { id: string; title: string } | undefined

      // Tier 1: trust mbTrackId FK
      if (mbTrack?.id) {
        matchedMb = mbTracks.find(m => m.id === mbTrack.id)
      }

      // Tier 2: exact normalized title match
      if (!matchedMb) {
        matchedMb = mbTracks.find(m =>
          !matchedMbIds.has(m.id) && normalizeTitle(m.title) === localNorm,
        )
      }

      // Tier 3: substring fallback
      if (!matchedMb) {
        matchedMb = mbTracks.find((m) => {
          if (matchedMbIds.has(m.id)) {
            return false
          }
          const mbNorm = normalizeTitle(m.title)
          return localNorm.length > 0 && mbNorm.length > 0
            && (mbNorm.includes(localNorm) || localNorm.includes(mbNorm))
        })
      }

      if (matchedMb) {
        matchedMbIds.add(matchedMb.id)
        if (normalizeTitle(matchedMb.title) !== localNorm) {
          mbTitle = matchedMb.title
        }
      }
    }

    enrichedTracks.push({
      ...t,
      artists: trackRelatedArtists
        .filter(ta => !albumArtistSlugs.has(ta.artist.slug))
        .map(ta => ({ name: ta.artist.name, slug: ta.artist.slug })),
      missing: false,
      mbTitle,
      mbTrackMusicbrainzId: mbTrack?.musicbrainzId || null,
    })
  }

  // Add truly missing MB tracks (no exact or substring match)
  if (mbTracks) {
    for (const mbt of mbTracks) {
      if (!matchedMbIds.has(mbt.id)) {
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
          mbTitle: null,
          mbTrackMusicbrainzId: mbt.musicbrainzId || null,
        })
      }
    }
    // Re-sort by disc then track number
    enrichedTracks.sort((a, b) => {
      const da = a.discNumber ?? 0
      const db = b.discNumber ?? 0
      if (da !== db) {return da - db}
      const ta = a.trackNumber ?? 0
      const tb = b.trackNumber ?? 0
      return ta - tb
    })
  }

  const releaseImg = release ? verifyImage(release.image, release.imageUrl, 'releases') : null
  return {
    release: release
      ? {
          id: release.id,
          title: release.title,
          image: releaseImg!.image,
          imageUrl: releaseImg!.imageUrl,
          artistName: release.artists[0]?.artist?.primaryArtist?.name ?? release.artists[0]?.artist?.name ?? 'Unknown',
          artistSlug: release.artists[0]?.artist?.primaryArtist?.slug ?? release.artists[0]?.artist?.slug ?? '',
        }
      : null,
    tracks: enrichedTracks,
  }
}
