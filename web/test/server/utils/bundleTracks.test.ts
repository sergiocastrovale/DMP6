import { describe, expect, it } from 'vitest'
import { linkBoxDiscTracks, mapBundleMbTracks } from '../../../server/utils/bundleTracks'
import type { BoxDiscLocalTrack, BoxMbTrackRow, BundleLinkedLocalTrack, BundleMbTrackRow } from '../../../server/utils/bundleTracks'

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

const boxTrack = (disc: number, position: number, recordingId: string | null = null): BoxMbTrackRow =>
  ({ id: `box-${disc}-${position}`, discNumber: disc, position, recordingId })

// Every disc folder of a dissolved box is typically tagged as its own disc 1, and its tracks point
// (mbTrackId) at the standalone album they reprint.
const discTrack = (disc: number, trackNumber: number | null, recordingId: string | null = null): BoxDiscLocalTrack => ({
  ...linkedTrack({ id: `local-${disc}-${trackNumber}`, mbTrackId: `standalone-${disc}-${trackNumber}` }),
  trackNumber,
  discNumber: 1,
  localReleaseId: `disc-lr-${disc}`,
  boxMediumPosition: disc,
  recordingId,
})

describe('linkBoxDiscTracks', () => {
  it('links each disc folder onto its own medium by position (Deliverance & Damnation: 6 + 8)', () => {
    const boxTracks = [...Array.from({ length: 6 }, (_, i) => boxTrack(1, i + 1)), ...Array.from({ length: 8 }, (_, i) => boxTrack(2, i + 1))]
    const discTracks = [...Array.from({ length: 6 }, (_, i) => discTrack(1, i + 1)), ...Array.from({ length: 8 }, (_, i) => discTrack(2, i + 1))]
    const linked = linkBoxDiscTracks(boxTracks, discTracks)
    expect(linked).toHaveLength(14)
    expect(linked.find(t => t.id === 'local-2-1')).toMatchObject({ mbTrackId: 'box-2-1', discNumber: 2, localReleaseId: 'disc-lr-2' })
    expect(linked.find(t => t.id === 'local-1-1')).toMatchObject({ mbTrackId: 'box-1-1', discNumber: 1 })

    const mapped = mapBundleMbTracks(boxTracks.map(b => ({ ...b, title: b.id, durationMs: null, musicbrainzId: null })), linked)
    expect(mapped.every(t => !t.missing)).toBe(true)
    expect(mapped.map(t => t.discNumber)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2])
  })

  it('prefers a shared recording id over position', () => {
    const linked = linkBoxDiscTracks(
      [boxTrack(1, 1, 'rec-a'), boxTrack(1, 2, 'rec-b')],
      [discTrack(1, 1, 'rec-b'), discTrack(1, 2, 'rec-a')],
    )
    expect(linked.find(t => t.id === 'local-1-1')!.mbTrackId).toBe('box-1-2')
    expect(linked.find(t => t.id === 'local-1-2')!.mbTrackId).toBe('box-1-1')
  })

  it('never binds a track onto another medium, and drops what has no counterpart', () => {
    const linked = linkBoxDiscTracks([boxTrack(1, 1)], [discTrack(2, 1), discTrack(1, 5), discTrack(1, null)])
    expect(linked).toEqual([])
  })

  it('strips the box-only fields from its output', () => {
    const [t] = linkBoxDiscTracks([boxTrack(1, 1)], [discTrack(1, 1)])
    expect(t).not.toHaveProperty('boxMediumPosition')
    expect(t).not.toHaveProperty('recordingId')
  })
})
