import type { TrackInContext } from './common'

export interface ByteRange {
  start: number
  end: number
  chunkSize: number
}

export interface RandomTrackRow {
  id: string
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  localReleaseId: string | null
}

export interface AudioTags {
  track?: string
  title?: string
  disc?: string
  discTotal?: string
  year?: string
}

export interface TrackInfo {
  filePath: string
  genre: string | null
  bitrate: number | null
  sampleRate: number | null
  fileSize: number | null
  discNumber: number | null
  trackNumber: number | null
  playCount: number
  lastPlayedAt: string | null
  createdAt: string
  mbTrackId: string | null
  mbReleaseId: string | null
  mbReleaseGroupId: string | null
  bpm: string | null
  isrc: string | null
  label: string | null
  acousticId: string | null
  mood: string | null
  key: string | null
  replayGain: string | null
  encoder: string | null
}

export interface TrackTableRow {
  id: string
  track: TrackInContext
}

export interface Track {
  id: string
  title: string | null
  artist: string | null
  albumArtist: string | null
  album: string | null
  year: number | null
  genre: string | null
  duration: number | null
  trackNumber: number | null
  discNumber: number | null
  playCount: number
  filePath: string
  localReleaseId: string | null
  artists?: { name: string; slug: string }[]
  missing?: boolean
  mbTitle?: string | null
  mbTrackMusicbrainzId?: string | null
}
