export interface PlaylistSummary {
  id: string
  name: string
  slug: string
  description: string | null
  type: 'MANUAL' | 'GENRE'
  genreGroup: string | null
  createdAt: Date
  updatedAt: Date
  trackCount: number
  coverImages: Array<{
    image: string | null
    imageUrl: string | null
  }>
}

export interface PlaylistTrack {
  id: string
  position: number
  addedAt: Date
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

export interface PlaylistDetail {
  id: string
  name: string
  slug: string
  description: string | null
  type: 'MANUAL' | 'GENRE'
  genreGroup: string | null
  createdAt: Date
  updatedAt: Date
  tracks: PlaylistTrack[]
}
