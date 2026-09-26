import { describe, expect, it } from 'vitest'
import { buildEtag, contentDispositionAttachment, mimeForFile, parseRangeHeader } from '../../../server/utils/audioRange'

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

describe('contentDispositionAttachment', () => {
  it('quotes a plain ASCII name and repeats it percent-encoded', () => {
    expect(contentDispositionAttachment('01 - Song.mp3')).toBe('attachment; filename="01 - Song.mp3"; filename*=UTF-8\'\'01%20-%20Song.mp3')
  })

  it('never puts a character above U+00FF in the header value (Node rejects those)', () => {
    for (const name of ['01 - 東京.mp3', 'Кино - Группа крови.flac', '🎵 song.mp3', 'Ελληνικά.mp3']) {
      const header = contentDispositionAttachment(name)
      expect(header).toMatch(/^[\x20-\x7E]*$/)
      expect(header).toContain(`filename*=UTF-8''`)
    }
  })

  it('round-trips the real name through filename*', () => {
    const name = '01 - 東京 (live) *ok*\'s.mp3'
    const header = contentDispositionAttachment(name)
    const encoded = header.split('filename*=UTF-8\'\'')[1]!
    expect(decodeURIComponent(encoded)).toBe(name)
    expect(encoded).not.toMatch(/['()*]/)
  })

  it('strips quotes and backslashes from the ASCII fallback so it stays one quoted string', () => {
    const header = contentDispositionAttachment('a"b\\c.mp3')
    expect(header).toContain('filename="a_b_c.mp3"')
  })

  it('falls back to a fixed name when nothing ASCII-safe remains', () => {
    expect(contentDispositionAttachment('   ')).toContain('filename="download"')
  })
})
