import { describe, expect, it } from 'vitest'
import { toArtist, toAlbum, toSong } from '../../../../server/utils/subsonic/mappers'
import type { ArtistRow, AlbumRow, SongRow } from '../../../../server/utils/subsonic/select'

describe('toArtist', () => {
  it('maps id/name/coverArt/albumCount and omits starred when not favorited', () => {
    const row = { id: 'ar1', name: 'ABBA', image: null, imageUrl: null, _count: { localReleases: 3 } } as ArtistRow
    const out = toArtist(row, { starred: new Map() })
    expect(out).toMatchObject({ id: 'ar1', name: 'ABBA', coverArt: 'ar-ar1', albumCount: 3 })
    expect(out.starred).toBeUndefined()
  })

  it('includes starred as an ISO date when favorited', () => {
    const row = { id: 'ar1', name: 'ABBA', image: null, imageUrl: null, _count: { localReleases: 3 } } as ArtistRow
    const at = new Date('2026-01-01T00:00:00.000Z')
    const out = toArtist(row, { starred: new Map([['ar1', at]]) })
    expect(out.starred).toBe(at.toISOString())
  })
})

describe('toAlbum', () => {
  const row = {
    id: 'al1',
    title: 'OK Computer',
    year: 1997,
    image: null,
    imageUrl: null,
    totalDuration: 3000,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    artists: [{ artist: { id: 'ar1', name: 'Radiohead' } }],
    _count: { tracks: 12 },
  } as AlbumRow

  it('maps core fields and pulls the first owning artist', () => {
    const out = toAlbum(row, { plays: new Map(), starred: new Map() })
    expect(out).toMatchObject({
      id: 'al1',
      name: 'OK Computer',
      title: 'OK Computer',
      artist: 'Radiohead',
      artistId: 'ar1',
      coverArt: 'al-al1',
      songCount: 12,
      duration: 3000,
      year: 1997,
    })
  })

  it('reports per-user play stats when present', () => {
    const lastPlayedAt = new Date('2026-02-01T00:00:00.000Z')
    const out = toAlbum(row, { plays: new Map([['al1', { totalPlayCount: 5, lastPlayedAt }]]), starred: new Map() })
    expect(out.playCount).toBe(5)
    expect(out.played).toBe(lastPlayedAt.toISOString())
  })

  it('defaults duration to 0 rather than omitting it', () => {
    const out = toAlbum({ ...row, totalDuration: null }, { plays: new Map(), starred: new Map() })
    expect(out.duration).toBe(0)
  })
})

describe('toSong', () => {
  const row = {
    id: 'tr1',
    title: 'Paranoid Android',
    trackNumber: 2,
    discNumber: 1,
    year: 1997,
    genre: 'Alternative',
    duration: 383,
    bitrate: 320,
    sampleRate: 44100,
    filePath: 'Radiohead/OK Computer/02 Paranoid Android.flac',
    fileSize: 40000000n,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    localReleaseId: 'al1',
    localRelease: { id: 'al1', title: 'OK Computer', artists: [{ artist: { id: 'ar1', name: 'Radiohead' } }] },
  } as SongRow

  it('maps core song fields, content type and album/artist', () => {
    const out = toSong(row, { plays: new Map(), starred: new Map() })
    expect(out).toMatchObject({
      id: 'tr1',
      title: 'Paranoid Android',
      album: 'OK Computer',
      albumId: 'al1',
      artist: 'Radiohead',
      artistId: 'ar1',
      track: 2,
      discNumber: 1,
      coverArt: 'al-al1',
      contentType: 'audio/flac',
      suffix: 'flac',
      duration: 383,
      bitRate: 320,
      type: 'music',
      isVideo: false,
    })
    expect(out.size).toBe(40000000)
  })

  it('handles a track with no local release (orphan) gracefully', () => {
    const out = toSong({ ...row, localRelease: null }, { plays: new Map(), starred: new Map() })
    expect(out.album).toBeUndefined()
    expect(out.coverArt).toBeUndefined()
    expect(out.artist).toBeUndefined()
  })

  it('reports per-user play stats and starred when present', () => {
    const lastPlayedAt = new Date('2026-03-01T00:00:00.000Z')
    const starredAt = new Date('2026-02-15T00:00:00.000Z')
    const out = toSong(row, {
      plays: new Map([['tr1', { playCount: 4, lastPlayedAt }]]),
      starred: new Map([['tr1', starredAt]]),
    })
    expect(out.playCount).toBe(4)
    expect(out.played).toBe(lastPlayedAt.toISOString())
    expect(out.starred).toBe(starredAt.toISOString())
  })
})
