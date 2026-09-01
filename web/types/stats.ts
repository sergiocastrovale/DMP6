import type { Component } from 'vue'

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

// /statistics index page (pages/statistics/index.vue) card shapes.
export interface StatItem {
  label: string
  value: string
  link?: string
  info?: string
}

export interface StatSection {
  title: string
  icon: Component
  warn?: boolean
  items: StatItem[]
}

export interface StatTile {
  label: string
  value: string
  icon: Component
  link: string
}

export interface Statistics {
  artists: number
  mainArtists: number
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
  linkedArtists: number
}
