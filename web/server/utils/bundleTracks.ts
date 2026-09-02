// Pure mapping extracted from server/api/releases/[id]/tracks.get.ts's owned-bundle branch: an MB
// release with no dedicated LocalRelease may still have some/all of its tracks individually claimed
// into another folder's local release (claim_owned_bundle, see CLAUDE.md). Isolated here for direct
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

export function mapBundleMbTracks(mbTracks: BundleMbTrackRow[], linkedLocalTracks: BundleLinkedLocalTrack[]) {
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
