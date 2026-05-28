export interface AppStats {
  artists: number
  releases: number
  tracks: number
  genres: number
  playtime: number
  totalFileSize: number
  totalPlays: number
  playlists: number
  favorites: number
  issues: number
}

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
