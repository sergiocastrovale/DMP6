import { describe, expect, it } from 'vitest'
import { toPlayerTrack } from '../../helpers/playerTrack'

describe('toPlayerTrack', () => {
  it('maps a complete track and its context', () => {
    expect(toPlayerTrack(
      { id: 't1', title: 'Song', artist: 'Band', album: 'Album', duration: 201, localReleaseId: 'r1' },
      { artistSlug: 'band', releaseImage: 'c.jpg', releaseImageUrl: 'http://c' },
    )).toEqual({
      id: 't1', title: 'Song', artist: 'Band', album: 'Album', duration: 201, artistSlug: 'band',
      releaseImage: 'c.jpg', releaseImageUrl: 'http://c', localReleaseId: 'r1',
    })
  })

  it('applies one set of fallbacks to a thin track', () => {
    expect(toPlayerTrack({ id: 't2' })).toEqual({
      id: 't2', title: 'Unknown', artist: 'Unknown', album: '', duration: 0, artistSlug: null,
      releaseImage: null, releaseImageUrl: null, localReleaseId: null,
    })
  })

  it('falls back from artist to album artist, and from album to the context album', () => {
    const t = toPlayerTrack({ id: 't3', title: 'x', albumArtist: 'Various' }, { album: 'Compilation' })
    expect(t.artist).toBe('Various')
    expect(t.album).toBe('Compilation')
    expect(toPlayerTrack({ id: 't4', album: 'Own' }, { album: 'Ctx' }).album).toBe('Own')
  })

  it('treats empty strings and null like missing', () => {
    const t = toPlayerTrack({ id: 't5', title: '', artist: '', album: null, duration: null, localReleaseId: undefined }, { artistSlug: '', releaseImage: '' })
    expect(t).toMatchObject({ title: 'Unknown', artist: 'Unknown', album: '', duration: 0, artistSlug: null, releaseImage: null, localReleaseId: null })
  })
})

describe('playlistTrackToPlayerTrack', () => {
  it('flattens a playlist track with its nested release', async () => {
    const { playlistTrackToPlayerTrack } = await import('../../helpers/playerTrack')
    expect(playlistTrackToPlayerTrack({
      id: 't1', title: 'Song', duration: 100,
      release: { id: 'r1', title: 'Album', image: 'c.jpg', imageUrl: null, artist: { name: 'Band', slug: 'band' } },
    })).toEqual({
      id: 't1', title: 'Song', artist: 'Band', album: 'Album', duration: 100, artistSlug: 'band',
      releaseImage: 'c.jpg', releaseImageUrl: null, localReleaseId: 'r1',
    })
  })

  it('copes with a track whose release is gone', async () => {
    const { playlistTrackToPlayerTrack } = await import('../../helpers/playerTrack')
    expect(playlistTrackToPlayerTrack({ id: 't2', title: 'x', release: null })).toMatchObject({ artist: 'Unknown', album: '', artistSlug: null, localReleaseId: null })
  })
})
