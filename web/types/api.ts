export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface SearchResults {
  artists: SearchArtistResult[]
  releases: SearchReleaseResult[]
  tracks: SearchTrackResult[]
}

export interface SearchArtistResult {
  id: string
  name: string
  slug: string
  image: string | null
  imageUrl: string | null
}

export interface SearchReleaseResult {
  id: string
  title: string
  year: number | null
  image: string | null
  imageUrl: string | null
  artistName: string
  artistSlug: string
}

export interface SearchTrackResult {
  id: string
  title: string
  artist: string | null
  album: string | null
  duration: number | null
  artistSlug: string | null
}
