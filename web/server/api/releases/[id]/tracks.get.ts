import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { linkBoxDiscTracks, mapBundleMbTracks } from '~/server/utils/bundleTracks'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { trackPlaysByIds, withTrackPlay } from '~/server/utils/userPlays'

const normalizeTitle = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-]/g, '')
    .replace(/[^\w\s]/g, '')
    .trim()
}

export default defineEventHandler(async (event) => {
  const userId = currentUserId(event)
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
          recordingId: true,
        },
        orderBy: [{ discNumber: 'asc' }, { position: 'asc' }],
      },
    },
  })

  const localReleaseId = mbRelease?.localReleases[0]?.id

  if (localReleaseId) {
    return getLocalReleaseTracks(userId, localReleaseId, mbRelease?.tracks)
  }

  if (mbRelease) {
    // No dedicated LocalRelease for this MB release, but its tracks may still be linked to local
    // tracks living in other folders' releases - the shape a dissolved box leaves behind, where each
    // disc binds standalone (docs/sync_decisions.md). Resolve those directly by mbTrackId rather than
    // reusing getLocalReleaseTracks, which scopes by localReleaseId and would pull in every track of
    // whichever folder happened to match first.
    const localTrackSelect = {
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
      filePath: true,
      localReleaseId: true,
      mbTrackId: true,
      trackRelatedArtists: {
        select: { artist: { select: { name: true, slug: true } } },
      },
    } as const
    const linkedByMbTrackId = await prisma.localReleaseTrack.findMany({
      where: { mbTrackId: { in: mbRelease.tracks.map(t => t.id) } },
      select: localTrackSelect,
    })
    // A dissolved box's discs bind to the standalone albums they reprint, so their tracks never point
    // at the box's own tracks - re-link them through the disc's boxMediumPosition instead.
    const boxDiscs = await prisma.localRelease.findMany({
      where: { boxReleaseId: mbRelease.id },
      orderBy: { boxMediumPosition: 'asc' },
      select: {
        image: true,
        imageUrl: true,
        boxMediumPosition: true,
        artists: { select: { artist: { select: { name: true, slug: true } } } },
        tracks: { select: { ...localTrackSelect, mbTrack: { select: { recordingId: true } } } },
      },
    })
    const alreadyLinked = new Set(linkedByMbTrackId.map(t => t.mbTrackId))
    const boxLinked = linkBoxDiscTracks(
      mbRelease.tracks.filter(t => !alreadyLinked.has(t.id)),
      boxDiscs.flatMap(d => d.tracks.map(({ mbTrack, ...t }) => ({
        ...t,
        playCount: 0,
        boxMediumPosition: d.boxMediumPosition,
        recordingId: mbTrack?.recordingId ?? null,
      }))),
    )
    const linkedLocalTracks = [...linkedByMbTrackId, ...boxLinked]
    const firstDisc = boxDiscs[0]
    const firstDiscArtist = firstDisc?.artists[0]?.artist
    const boxImg = firstDisc ? verifyImage(firstDisc.image, firstDisc.imageUrl, 'releases') : null
    const linkedPlays = await trackPlaysByIds(userId, linkedLocalTracks.map(t => t.id))
    return {
      release: {
        id: mbRelease.id,
        title: mbRelease.title,
        image: boxImg?.image ?? null,
        imageUrl: boxImg?.imageUrl ?? null,
        artistName: firstDiscArtist?.name ?? 'Unknown',
        artistSlug: firstDiscArtist?.slug ?? '',
      },
      tracks: mapBundleMbTracks(mbRelease.tracks ?? [], linkedLocalTracks.map(t => withTrackPlay(t, linkedPlays))),
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

  return getLocalReleaseTracks(userId, id, localRelease?.release?.tracks)
})

const getLocalReleaseTracks = async (
  userId: number,
  localReleaseId: string,
  mbTracks?: { id: string; title: string; position: number | null; discNumber: number | null; durationMs: number | null; musicbrainzId: string | null }[],
) => {
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

  const plays = await trackPlaysByIds(userId, tracks.map(t => t.id))

  // Build enriched tracks, checking for MB title differences via substring matching
  const enrichedTracks: any[] = []
  const matchedMbIds = new Set<string>()

  for (const { trackRelatedArtists, mbTrack, ...raw } of tracks) {
    const t = withTrackPlay(raw, plays)
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
