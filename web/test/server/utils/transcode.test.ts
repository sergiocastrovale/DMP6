import { describe, expect, it } from 'vitest'
import { ext, sanitize } from '../../../server/utils/transcode'

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
