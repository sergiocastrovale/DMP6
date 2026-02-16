export interface Statistics {
  artists: number
  tracks: number
  releases: number
  genres: number
  playtime: number
  plays: number
  artistsSyncedWithMusicbrainz: number
  releasesSyncedWithMusicbrainz: number
  artistsWithCoverArt: number
  releasesWithCoverArt: number
  lastScanStartedAt: string | null
  lastScanEndedAt: string | null
}
