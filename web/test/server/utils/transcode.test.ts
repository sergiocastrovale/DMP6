import { describe, expect, it } from 'vitest'
import { buildTrackFilename, ext, sanitize } from '../../../server/utils/transcode'

describe('ext', () => {
  it('returns the lowercased extension without the dot', () => {
    expect(ext('Track.FLAC')).toBe('flac')
    expect(ext('/a/b/track.mp3')).toBe('mp3')
  })

  it('returns empty string for no extension', () => {
    expect(ext('noext')).toBe('')
  })
})

describe('sanitize', () => {
  it('replaces filesystem-illegal characters with underscores', () => {
    expect(sanitize('Who: Made Who? <Deluxe>')).toBe('Who_ Made Who_ _Deluxe_')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitize('  Spaced   Out  ')).toBe('Spaced Out')
  })

  it('truncates to 200 characters', () => {
    expect(sanitize('A'.repeat(300)).length).toBe(200)
  })
})

describe('buildTrackFilename', () => {
  it('builds NN. Title.mp3 for a single-disc release', () => {
    expect(buildTrackFilename({ track: '3', title: 'Intro' })).toBe('03. Intro.mp3')
  })

  it('returns null when track or title is missing', () => {
    expect(buildTrackFilename({ title: 'Intro' })).toBeNull()
    expect(buildTrackFilename({ track: '3' })).toBeNull()
  })

  it('returns null when track is not a parseable number', () => {
    expect(buildTrackFilename({ track: 'abc', title: 'Intro' })).toBeNull()
  })

  it('handles a "N/total" track tag', () => {
    expect(buildTrackFilename({ track: '3/12', title: 'Intro' })).toBe('03. Intro.mp3')
  })

  it('prefixes the disc number when discTotal > 1 - Disc 1/Disc 2 Track 1 no longer collide (audit #83)', () => {
    const disc1 = buildTrackFilename({ track: '1', title: 'Same Track Name', disc: '1', discTotal: '2' })
    const disc2 = buildTrackFilename({ track: '1', title: 'Same Track Name', disc: '2', discTotal: '2' })
    expect(disc1).toBe('1-01. Same Track Name.mp3')
    expect(disc2).toBe('2-01. Same Track Name.mp3')
    expect(disc1).not.toBe(disc2)
  })

  it('does not prefix disc when discTotal is 1 or absent', () => {
    expect(buildTrackFilename({ track: '1', title: 'Intro', disc: '1', discTotal: '1' })).toBe('01. Intro.mp3')
    expect(buildTrackFilename({ track: '1', title: 'Intro', disc: '1' })).toBe('01. Intro.mp3')
  })
})
