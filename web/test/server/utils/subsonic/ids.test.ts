import { describe, expect, it } from 'vitest'
import { artistCoverArt, albumCoverArt, playlistCoverArt, parseCoverArtId } from '../../../../server/utils/subsonic/ids'

describe('cover art id prefixing', () => {
  it('round-trips artist/album/playlist ids through their prefix', () => {
    expect(parseCoverArtId(artistCoverArt('clx1'))).toEqual({ type: 'artist', id: 'clx1' })
    expect(parseCoverArtId(albumCoverArt('clx2'))).toEqual({ type: 'album', id: 'clx2' })
    expect(parseCoverArtId(playlistCoverArt('clx3'))).toEqual({ type: 'playlist', id: 'clx3' })
  })

  it('returns null for an unrecognized prefix', () => {
    expect(parseCoverArtId('clx4')).toBeNull()
    expect(parseCoverArtId('xx-clx4')).toBeNull()
  })
})
