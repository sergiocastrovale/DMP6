export interface Statistics {
  artists: number
  mainArtists: number
  relatedArtists: number
  tracks: number
  releases: number
  genres: number
  playtime: number
  plays: number
  artistsSyncedWithMusicbrainz: number
  releasesSyncedWithMusicbrainz: number
  artistsWithCoverArt: number
  releasesWithCoverArt: number
  totalFileSize: number
  lastScanStartedAt: string | null
  lastScanEndedAt: string | null
  unmatchedReleases: number
  incompleteReleases: number
  lowBitrateTracks: number
  singleReleaseArtists: number
  missingArtReleases: number
}
