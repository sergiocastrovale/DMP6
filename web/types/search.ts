export interface SearchArtist {
  id: string
  name: string
  slug: string
  image: string | null
  imageUrl: string | null
}

export interface SearchRelease {
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

export interface SearchTrack {
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

export interface SearchResults {
  artists: SearchArtist[]
  releases: SearchRelease[]
  tracks: SearchTrack[]
}
