import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/utils/images', () => ({
  verifyImage: (image: string | null, imageUrl: string | null) => ({ image, imageUrl }),
}))

const { toReleaseTile, firstArtist, RELEASE_TILE_SELECT, RELEASE_TILE_SELECT_NO_GENRE } = await import('../../../server/utils/releaseTiles')

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  title: 'Local Title',
  year: 1999,
  image: 'a.jpg',
  imageUrl: null,
  artists: [{ artist: { id: 'a1', name: 'Artist', slug: 'artist' } }],
  release: { id: 'mb1', title: 'MB Title', type: { name: 'Album' } },
  tracks: [{ genre: 'Rock' }],
  ...over,
})

describe('toReleaseTile', () => {
  it('maps a full row to the tile shape', () => {
    expect(toReleaseTile(row())).toEqual({
      id: 'r1',
      title: 'Local Title',
      releaseType: 'Album',
      year: 1999,
      image: 'a.jpg',
      imageUrl: null,
      genre: 'Rock',
      artist: { id: 'a1', name: 'Artist', slug: 'artist' },
      musicBrainzId: 'mb1',
    })
  })

  it('falls back to the MusicBrainz title, then "Unknown Release", when the local title is empty', () => {
    expect(toReleaseTile(row({ title: '' })).title).toBe('MB Title')
    expect(toReleaseTile(row({ title: '', release: null })).title).toBe('Unknown Release')
  })

  it('tolerates a missing release, artist and genre', () => {
    const tile = toReleaseTile(row({ release: null, artists: [], tracks: [] }))
    expect(tile).toMatchObject({ releaseType: null, artist: null, genre: null, musicBrainzId: null })
  })

  it('tolerates a select without tracks (timeline, search)', () => {
    expect(toReleaseTile(row({ tracks: undefined })).genre).toBeNull()
  })
})

describe('firstArtist', () => {
  it('returns the first artist or null', () => {
    expect(firstArtist({ artists: [{ artist: 'x' }, { artist: 'y' }] })).toBe('x')
    expect(firstArtist({ artists: [] })).toBeNull()
  })
})

describe('tile selects', () => {
  it('never select the wide LocalRelease columns a tile does not show', () => {
    for (const wide of ['folderPath', 'statusReason', 'groupKey', 'totalFileSize']) {
      expect(RELEASE_TILE_SELECT).not.toHaveProperty(wide)
    }
  })

  it('the no-genre variant drops the track lookup', () => {
    expect(RELEASE_TILE_SELECT_NO_GENRE.tracks).toBe(false)
    expect(RELEASE_TILE_SELECT.tracks).toBeTruthy()
  })
})
