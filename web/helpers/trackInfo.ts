import type { Track, TrackInfo } from '~/types/track'
import { formatDuration } from '~/helpers/functions'

export interface TrackInfoRow {
  label: string
  value: string
  // A long unbroken value (a file path) that must wrap anywhere.
  breakAll?: boolean
}

export const formatTrackFileSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

// The rows of the track info dialog: what the list already knows about the track, then what the info endpoint adds. A row
// is left out when it has nothing to show.
export const trackInfoRows = (track: Track, info: TrackInfo | null): TrackInfoRow[] => {
  const rows: TrackInfoRow[] = [{ label: 'Track ID', value: track.id }]
  const add = (label: string, value: string | number | null | undefined, breakAll = false) => {
    if (value) {
      rows.push({ label, value: String(value), ...(breakAll ? { breakAll } : {}) })
    }
  }

  add('File path', track.filePath, true)
  add('Artist', track.artist)
  add('Album', track.album)
  add('Album artist', track.albumArtist)
  add('Genre', track.genre)
  if (track.trackNumber) {
    add('Track', `${track.discNumber ? `Disc ${track.discNumber}, ` : ''}Track ${track.trackNumber}`)
  }
  if (track.duration) {
    add('Duration', formatDuration(track.duration))
  }
  add('Year', track.year)

  if (info) {
    if (!track.filePath) {
      add('File path', info.filePath, true)
    }
    if (info.bitrate || info.sampleRate) {
      add('Audio', [
        info.bitrate ? `${Math.round(info.bitrate / 1000)} kbps` : '',
        info.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : '',
      ].filter(Boolean).join(' · '))
    }
    if (info.fileSize) {
      add('File size', formatTrackFileSize(info.fileSize))
    }
    add('BPM', info.bpm)
    add('Key', info.key)
    add('Mood', info.mood)
    add('ISRC', info.isrc)
    add('Label', info.label)
    add('Replay gain', info.replayGain)
    add('Encoder', info.encoder)
    add('AcoustID', info.acousticId)
    add('Play count', info.playCount)
    if (info.lastPlayedAt) {
      add('Last played', new Date(info.lastPlayedAt).toLocaleString())
    }
    if (info.createdAt) {
      add('Indexed', new Date(info.createdAt).toLocaleString())
    }
    add('MusicBrainz recording', info.mbTrackId)
    add('MusicBrainz release', info.mbReleaseId)
  }

  return rows
}
