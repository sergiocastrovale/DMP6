import type { ArtistSummary } from './common'

export type RelatedArtist = ArtistSummary

export interface ArtistListItem extends ArtistSummary {
  completeness: number | null
  totalPlayCount: number
  totalTracks: number
  releaseCount?: number
  musicbrainzId: string | null
  // Set only when another artist in the library has the same name: what tells this one apart.
  homonymNote?: string | null
}

export interface Artist extends ArtistListItem {
  totalFileSize: bigint | number | string
  lastSyncedAt: string | null
  monitored?: boolean
  genres: Genre[]
  urls: ArtistUrl[]
  relatedArtists?: RelatedArtist[]
  country?: string | null
  disambiguation?: string | null
  // Other artists with this same name (docs/sync_decisions.md "Two artists, one name"); empty when there are none.
  homonyms?: ArtistHomonym[]
}

// One of several artists sharing a name - a chooser card or an "Also named" chip.
export interface ArtistHomonym {
  id: string
  name: string
  slug: string
  musicbrainzId: string | null
  country: string | null
  disambiguation: string | null
  releaseCount: number
  image: string | null
  imageUrl: string | null
}

// What `/api/artists/<slug>` answers when the slug is a name several artists share.
export interface ArtistChooser {
  chooser: true
  name: string
  homonyms: ArtistHomonym[]
}

// ...and when the slug is one an artist used to have (or the base of a name only one artist has now).
export interface ArtistRedirect {
  redirectTo: string
}

export type ArtistPageResponse = (Artist & { totalPlayCount: number }) | ArtistChooser | ArtistRedirect

export interface ReleaseStatsResult {
  releaseCount: number
}

export interface CatalogueCounts {
  total: number
  albums: number
  eps: number
  singles: number
}

export interface MonitoringArtistRow {
  id: string
  name: string
  slug: string
  monitored: boolean
  missingReleases: number
  totalReleases: number
}

export interface ArtistUrl {
  id: string
  type: string
  url: string
}

export interface MbArtistSearchRow {
  mbid: string
  name: string
  disambiguation: string | null
  country: string | null
  type: string | null
  existing: { slug: string, name: string } | null
  // Another artist in the library with this same name (a different MusicBrainz artist, or one not yet identified).
  // Adding is fine - both get their own page (docs/sync_decisions.md "Two artists, one name").
  namesake: { slug: string, identified: boolean } | null
}

export interface Genre {
  id: string
  name: string
}

export interface ArtistFactResponse {
  text: string
  sourceUrl: string | null
  release: { id: string, title: string } | null
  track: { id: string, title: string | null } | null
}
