export interface Playlist {
  id: string
  name: string
  description: string | null
  image: string | null
  createdAt: string
  updatedAt: string
  trackCount: number
}

export interface PlaylistDetail extends Playlist {
  tracks: PlaylistTrackItem[]
}

export interface PlaylistTrackItem {
  id: string
  position: number
  track: {
    id: string
    title: string | null
    artist: string | null
    album: string | null
    duration: number | null
    playCount: number
    filePath: string
  }
}
