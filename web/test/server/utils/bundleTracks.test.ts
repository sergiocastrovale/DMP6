import { describe, expect, it } from 'vitest'
import { mapBundleMbTracks } from '../../../server/utils/bundleTracks'
import type { BundleLinkedLocalTrack, BundleMbTrackRow } from '../../../server/utils/bundleTracks'

const mbTrack = (overrides: Partial<BundleMbTrackRow> & { id: string }): BundleMbTrackRow => ({
  title: 'Untitled',
  position: 1,
  discNumber: 1,
  durationMs: 180_000,
  musicbrainzId: `mbtid-${overrides.id}`,
  ...overrides,
})

const linkedTrack = (overrides: Partial<BundleLinkedLocalTrack> & { id: string, mbTrackId: string }): BundleLinkedLocalTrack => ({
  title: 'Untitled Local',
  artist: 'Bing Crosby',
  albumArtist: 'Bing Crosby',
  album: 'Bing With a Beat',
  year: 1957,
  genre: null,
  duration: 180,
  trackNumber: 1,
  discNumber: 1,
  playCount: 0,
  filePath: '/music/Bing Crosby/Bing With a Beat/01.flac',
  localReleaseId: 'parent-lr',
  trackRelatedArtists: [],
  ...overrides,
})

describe('mapBundleMbTracks', () => {
  it('marks a track with a linked LocalReleaseTrack as present, using the real local track id', () => {
    const tracks = mapBundleMbTracks(
      [mbTrack({ id: 'mbt1' })],
      [linkedTrack({ id: 'local1', mbTrackId: 'mbt1' })],
    )
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ id: 'local1', missing: false, localReleaseId: 'parent-lr' })
  })

  it('marks an unlinked track as missing, with no local id', () => {
    const tracks = mapBundleMbTracks([mbTrack({ id: 'mbt1', title: 'Ghost Track' })], [])
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ id: 'mbt1', title: 'Ghost Track', missing: true, localReleaseId: null, filePath: '' })
  })

  it('handles a partially-linked bundle: mixed missing flags in track order', () => {
    const tracks = mapBundleMbTracks(
      [mbTrack({ id: 'mbt1' }), mbTrack({ id: 'mbt2' })],
      [linkedTrack({ id: 'local1', mbTrackId: 'mbt1' })],
    )
    expect(tracks.map(t => t.missing)).toEqual([false, true])
  })

  it('maps trackRelatedArtists to the flat artists shape and drops the internal mbTrackId field', () => {
    const tracks = mapBundleMbTracks(
      [mbTrack({ id: 'mbt1' })],
      [linkedTrack({
        id: 'local1', mbTrackId: 'mbt1',
        trackRelatedArtists: [{ artist: { name: 'Guest', slug: 'guest' } }],
      })],
    )
    expect(tracks[0]!.artists).toEqual([{ name: 'Guest', slug: 'guest' }])
    expect(tracks[0]).not.toHaveProperty('mbTrackId')
    expect(tracks[0]).not.toHaveProperty('trackRelatedArtists')
  })
})
