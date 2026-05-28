export interface ArtistRef {
  id: string
  name: string
  slug: string
}

export interface ArtistSummary extends ArtistRef {
  image: string | null
  imageUrl: string | null
}

export interface ReleaseRef {
  id: string
  title: string
  year: number | null
  image: string | null
  imageUrl: string | null
}

export interface TrackInContext {
  id: string
  title: string
  trackNumber: number | null
  duration: number | null
  release: (ReleaseRef & { artist: ArtistRef | null }) | null
}

export type PlaylistType = 'MANUAL' | 'GENRE' | 'REGION'
