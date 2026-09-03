import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({ findUnique: vi.fn() }))

vi.mock('~/server/utils/prisma', () => ({
  prisma: { settings: { findUnique: prismaMocks.findUnique } },
}))

const { DEFAULT_DOWNLOAD_DIR_TEMPLATE, resolveDownloadDir, resolveDownloadSettings } = await import('../../../server/utils/downloadSettings')

describe('resolveDownloadDir', () => {
  it('renders artist/album/year placeholders', () => {
    expect(resolveDownloadDir(DEFAULT_DOWNLOAD_DIR_TEMPLATE, 'Boards of Canada', 'Geogaddi', 2002))
      .toBe('Boards of Canada/2002 - Geogaddi')
  })

  it('falls back to "Unknown Artist"/"Unknown Album" for empty strings', () => {
    expect(resolveDownloadDir('{artist}/{album}', '', '', undefined)).toBe('Unknown Artist/Unknown Album')
  })

  it('collapses the year placeholder and its separator when year is null', () => {
    expect(resolveDownloadDir(DEFAULT_DOWNLOAD_DIR_TEMPLATE, 'Artist', 'Album', null))
      .toBe('Artist/Album')
  })

  it('collapses the year placeholder when year is undefined', () => {
    expect(resolveDownloadDir(DEFAULT_DOWNLOAD_DIR_TEMPLATE, 'Artist', 'Album', undefined))
      .toBe('Artist/Album')
  })

  it('collapses the year placeholder when year is non-finite', () => {
    expect(resolveDownloadDir(DEFAULT_DOWNLOAD_DIR_TEMPLATE, 'Artist', 'Album', NaN))
      .toBe('Artist/Album')
  })

  it('sanitizes illegal filesystem characters in the placeholder values before insertion (a slash in the artist name cannot create an extra directory)', () => {
    expect(resolveDownloadDir('{artist}/{album}', 'AC/DC', 'Who: Made Who?', undefined))
      .toBe('AC_DC/Who_ Made Who_')
  })

  it('collapses repeated whitespace and trims', () => {
    expect(resolveDownloadDir('{artist}', '  Spaced   Out  ', '', undefined)).toBe('Spaced Out')
  })

  it('truncates an overlong segment to 200 characters', () => {
    const longName = 'A'.repeat(300)
    const result = resolveDownloadDir('{artist}', longName, '', undefined)
    expect(result.length).toBe(200)
  })

  it('preserves slashes as path segment separators while sanitizing each segment', () => {
    const result = resolveDownloadDir('{artist}/sub:dir/{album}', 'Artist', 'Al*bum', undefined)
    expect(result).toBe('Artist/sub_dir/Al_bum')
  })
})

describe('resolveDownloadSettings: flacToMp3', () => {
  const originalEnv = process.env.FLAC_TO_MP3

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.FLAC_TO_MP3
  })

  afterEach(() => {
    if (originalEnv === undefined) {delete process.env.FLAC_TO_MP3}
    else {process.env.FLAC_TO_MP3 = originalEnv}
  })

  it('is true when the DB value is null and FLAC_TO_MP3 is unset (default)', async () => {
    prismaMocks.findUnique.mockResolvedValue({ flacToMp3: null })
    expect((await resolveDownloadSettings()).flacToMp3).toBe(true)
  })

  it('falls back to FLAC_TO_MP3=false when the DB value is null', async () => {
    process.env.FLAC_TO_MP3 = 'false'
    prismaMocks.findUnique.mockResolvedValue({ flacToMp3: null })
    expect((await resolveDownloadSettings()).flacToMp3).toBe(false)
  })

  it('DB value wins over FLAC_TO_MP3 when explicitly set', async () => {
    process.env.FLAC_TO_MP3 = 'false'
    prismaMocks.findUnique.mockResolvedValue({ flacToMp3: true })
    expect((await resolveDownloadSettings()).flacToMp3).toBe(true)
  })
})

describe('resolveDownloadSettings: flacToMp3Bitrate', () => {
  const originalEnv = process.env.FLAC_TO_MP3_BITRATE

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.FLAC_TO_MP3_BITRATE
  })

  afterEach(() => {
    if (originalEnv === undefined) {delete process.env.FLAC_TO_MP3_BITRATE}
    else {process.env.FLAC_TO_MP3_BITRATE = originalEnv}
  })

  it('is 320 when the DB value is null and FLAC_TO_MP3_BITRATE is unset (default)', async () => {
    prismaMocks.findUnique.mockResolvedValue({ flacToMp3Bitrate: null })
    expect((await resolveDownloadSettings()).flacToMp3Bitrate).toBe(320)
  })

  it('falls back to FLAC_TO_MP3_BITRATE when the DB value is null', async () => {
    process.env.FLAC_TO_MP3_BITRATE = '192'
    prismaMocks.findUnique.mockResolvedValue({ flacToMp3Bitrate: null })
    expect((await resolveDownloadSettings()).flacToMp3Bitrate).toBe(192)
  })

  it('DB value wins over FLAC_TO_MP3_BITRATE when explicitly set', async () => {
    process.env.FLAC_TO_MP3_BITRATE = '192'
    prismaMocks.findUnique.mockResolvedValue({ flacToMp3Bitrate: 128 })
    expect((await resolveDownloadSettings()).flacToMp3Bitrate).toBe(128)
  })
})
