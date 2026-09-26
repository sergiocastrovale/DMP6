import { describe, expect, it } from 'vitest'
import { formatTrackFileSize, trackInfoRows } from '../../helpers/trackInfo'
import type { Track, TrackInfo } from '../../types/track'

const track = (over: Partial<Track> = {}): Track => ({
  id: 't1', title: 'Song', artist: 'Band', albumArtist: null, album: 'Album', year: 1999, genre: 'rock',
  duration: 185, trackNumber: 3, discNumber: 1, playCount: 0, filePath: '/m/a.flac', localReleaseId: 'r1', ...over,
}) as Track

const info = (over: Partial<TrackInfo> = {}): TrackInfo => ({
  filePath: '/m/a.flac', genre: null, bitrate: 320_000, sampleRate: 44_100, fileSize: 5 * 1024 * 1024, discNumber: 1, trackNumber: 3,
  playCount: 7, lastPlayedAt: null, createdAt: '2026-01-02T03:04:05Z', mbTrackId: 'mbt', mbReleaseId: null, mbReleaseGroupId: null,
  bpm: null, isrc: null, label: null, acousticId: null, mood: null, key: null, replayGain: null, encoder: null, ...over,
}) as TrackInfo

const labels = (rows: { label: string }[]) => rows.map(r => r.label)

describe('trackInfoRows', () => {
  it('starts with the track id and shows only what the track has', () => {
    const rows = trackInfoRows(track({ albumArtist: null, genre: null, year: null }), null)
    expect(labels(rows)).toEqual(['Track ID', 'File path', 'Artist', 'Album', 'Track', 'Duration'])
    expect(rows[0]).toEqual({ label: 'Track ID', value: 't1' })
    expect(rows.find(r => r.label === 'File path')!.breakAll).toBe(true)
  })

  it('describes the disc and track number', () => {
    expect(trackInfoRows(track(), null).find(r => r.label === 'Track')!.value).toBe('Disc 1, Track 3')
    expect(trackInfoRows(track({ discNumber: null }), null).find(r => r.label === 'Track')!.value).toBe('Track 3')
  })

  it('adds the endpoint\'s extra rows, joins audio facts, and hides zero counts', () => {
    const rows = trackInfoRows(track(), info({ playCount: 0 }))
    const byLabel = Object.fromEntries(rows.map(r => [r.label, r.value]))
    expect(byLabel.Audio).toBe('320 kbps · 44.1 kHz')
    expect(byLabel['File size']).toBe('5.0 MB')
    expect(byLabel['MusicBrainz recording']).toBe('mbt')
    expect(labels(rows)).not.toContain('Play count')
    expect(labels(rows)).not.toContain('MusicBrainz release')
  })

  it('takes the file path from the endpoint only when the list did not have one', () => {
    expect(labels(trackInfoRows(track(), info())).filter(l => l === 'File path')).toHaveLength(1)
    const rows = trackInfoRows(track({ filePath: '' }), info({ filePath: '/other.flac' }))
    expect(rows.find(r => r.label === 'File path')).toEqual({ label: 'File path', value: '/other.flac', breakAll: true })
  })
})

describe('formatTrackFileSize', () => {
  it('uses KB below a megabyte and one-decimal MB above', () => {
    expect(formatTrackFileSize(512 * 1024)).toBe('512 KB')
    expect(formatTrackFileSize(1_572_864)).toBe('1.5 MB')
  })
})
