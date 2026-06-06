import { describe, expect, it } from 'vitest'
import { buildEtag, mimeForFile, parseRangeHeader } from '../server/utils/audioRange'

describe('mimeForFile', () => {
  it('maps known audio extensions', () => {
    expect(mimeForFile('/m/x.mp3')).toBe('audio/mpeg')
    expect(mimeForFile('/m/x.flac')).toBe('audio/flac')
    expect(mimeForFile('/m/x.m4a')).toBe('audio/mp4')
    expect(mimeForFile('/m/x.opus')).toBe('audio/opus')
    expect(mimeForFile('/m/x.wav')).toBe('audio/wav')
  })

  it('is case-insensitive and falls back to audio/mpeg', () => {
    expect(mimeForFile('/m/X.FLAC')).toBe('audio/flac')
    expect(mimeForFile('/m/x.xyz')).toBe('audio/mpeg')
    expect(mimeForFile('/m/noext')).toBe('audio/mpeg')
  })
})

describe('buildEtag', () => {
  it('is a quoted size-mtime token', () => {
    expect(buildEtag(123, 456.7)).toBe('"123-456.7"')
  })
})

describe('parseRangeHeader', () => {
  it('returns null without a Range header (caller serves full 200)', () => {
    expect(parseRangeHeader(undefined, 1000)).toBeNull()
    expect(parseRangeHeader('', 1000)).toBeNull()
  })

  it('parses an open-ended range to the last byte', () => {
    expect(parseRangeHeader('bytes=0-', 1000)).toEqual({ start: 0, end: 999, chunkSize: 1000 })
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ start: 500, end: 999, chunkSize: 500 })
  })

  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-499', 1000)).toEqual({ start: 0, end: 499, chunkSize: 500 })
    expect(parseRangeHeader('bytes=200-299', 1000)).toEqual({ start: 200, end: 299, chunkSize: 100 })
  })

  it('clamps end to the last byte', () => {
    expect(parseRangeHeader('bytes=0-99999', 1000)).toEqual({ start: 0, end: 999, chunkSize: 1000 })
  })

  it('handles a suffix range (last N bytes)', () => {
    expect(parseRangeHeader('bytes=-100', 1000)).toEqual({ start: 900, end: 999, chunkSize: 100 })
    expect(parseRangeHeader('bytes=-5000', 1000)).toEqual({ start: 0, end: 999, chunkSize: 1000 })
  })

  it('returns null for unsatisfiable or malformed ranges', () => {
    expect(parseRangeHeader('bytes=2000-3000', 1000)).toBeNull()
    expect(parseRangeHeader('bytes=-', 1000)).toBeNull()
    expect(parseRangeHeader('items=0-10', 1000)).toBeNull()
    expect(parseRangeHeader('bytes=0-499', 0)).toBeNull()
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseRangeHeader('  bytes=0-9  ', 1000)).toEqual({ start: 0, end: 9, chunkSize: 10 })
  })
})
