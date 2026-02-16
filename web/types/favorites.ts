export interface FavoriteRelease {
  id: string
  createdAt: Date
  release: {
    id: string
    title: string
    releaseType: string | null
    year: number | null
    image: string | null
    imageUrl: string | null
    artist: {
      id: string
      name: string
      slug: string
    } | null
  }
}

export interface FavoriteTrack {
  id: string
  createdAt: Date
  track: {
    id: string
    title: string
    trackNumber: number | null
    duration: number | null
    release: {
      id: string
      title: string
      year: number | null
      image: string | null
      imageUrl: string | null
      artist: {
        id: string
        name: string
        slug: string
      } | null
    } | null
  }
}

export interface FavoritesResponse {
  releases: FavoriteRelease[]
  tracks: FavoriteTrack[]
}
