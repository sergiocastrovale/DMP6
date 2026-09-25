// Pure mapping extracted from server/api/releases/[id]/tracks.get.ts's mbTrackId branch: an MB release
// with no dedicated LocalRelease may still have some/all of its tracks linked to local tracks that
// live in other folders' releases (a dissolved box, docs/sync_decisions.md). Isolated here for direct
// unit testing without a database.

export interface BundleMbTrackRow {
  id: string
  title: string
  position: number | null
  discNumber: number | null
  durationMs: number | null
  musicbrainzId: string | null
}

export interface BundleLinkedLocalTrack {
  id: string
  title: string | null
  artist: string | null
  albumArtist: string | null
  album: string | null
  year: number | null
  genre: string | null
  duration: number | null
  trackNumber: number | null
  discNumber: number | null
  playCount: number
  filePath: string
  localReleaseId: string | null
  mbTrackId: string | null
  trackRelatedArtists: { artist: { name: string, slug: string } }[]
}

export const mapBundleMbTracks = (mbTracks: BundleMbTrackRow[], linkedLocalTracks: BundleLinkedLocalTrack[]) => {
  const linkedByMbTrackId = new Map(linkedLocalTracks.map(t => [t.mbTrackId, t]))

  return mbTracks.map((mbt) => {
    const linked = linkedByMbTrackId.get(mbt.id)
    if (linked) {
      const { trackRelatedArtists, mbTrackId: _mbTrackId, ...t } = linked
      return {
        ...t,
        artists: trackRelatedArtists.map(ta => ({ name: ta.artist.name, slug: ta.artist.slug })),
        missing: false,
        mbTitle: null,
        mbTrackMusicbrainzId: mbt.musicbrainzId || null,
      }
    }
    return {
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
    }
  })
}

export interface BoxMbTrackRow {
  id: string
  discNumber: number | null
  position: number | null
  recordingId: string | null
}

export interface BoxDiscLocalTrack extends BundleLinkedLocalTrack {
  boxMediumPosition: number | null
  recordingId: string | null
}

// A dissolved box disc's tracks link (mbTrackId) to the standalone album it reprints, never to the
// box's own tracks (docs/sync_decisions.md §9), so the box's tracklist can't find them by mbTrackId.
// Re-links each disc track onto the box track it physically is: same medium (boxMediumPosition), then
// same recording, else same position - a reissue often carries new recording ids (a remaster) and the
// box pass itself bound the disc by title+length order. The folder's own disc tag is ignored in favour
// of the box's medium number, since each disc folder is usually tagged as its own "disc 1".
export const linkBoxDiscTracks = (boxTracks: BoxMbTrackRow[], discTracks: BoxDiscLocalTrack[]): BundleLinkedLocalTrack[] => {
  const claimed = new Set<string>()
  const linked: BundleLinkedLocalTrack[] = []
  const claim = (t: BoxDiscLocalTrack, match: BoxMbTrackRow | undefined) => {
    if (!match) { return }
    claimed.add(match.id)
    const { boxMediumPosition: _box, recordingId: _rec, ...rest } = t
    linked.push({ ...rest, mbTrackId: match.id, discNumber: match.discNumber })
  }
  const onDisc = (t: BoxDiscLocalTrack) =>
    boxTracks.filter(b => b.discNumber === t.boxMediumPosition && !claimed.has(b.id))

  const pending: BoxDiscLocalTrack[] = []
  for (const t of discTracks) {
    const match = t.recordingId ? onDisc(t).find(b => b.recordingId === t.recordingId) : undefined
    if (match) {
      claim(t, match)
    } else {
      pending.push(t)
    }
  }
  for (const t of pending) {
    claim(t, t.trackNumber == null ? undefined : onDisc(t).find(b => b.position === t.trackNumber))
  }
  return linked
}
