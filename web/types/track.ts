export interface Track {
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
}

export interface TrackWithRelease extends Track {
  releaseTitle: string | null
  releaseImage: string | null
  releaseImageUrl: string | null
  artistSlug: string | null
  artistName: string | null
}
